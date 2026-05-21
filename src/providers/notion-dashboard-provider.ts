import { Client } from "@notionhq/client";
import type {
  AppendBlockChildrenParameters,
  CreateDatabaseParameters,
  CreatePageParameters,
  DatabaseObjectResponse,
  PageObjectResponse,
  QueryDataSourceParameters,
  UpdatePageParameters
} from "@notionhq/client/build/src/api-endpoints";
import {
  notionApprovalMap,
  notionDashboardProperties,
  notionDashboardSchema,
  notionStatusMap,
  type NotionDashboardSchemaItem
} from "../domain/notion-dashboard";

export type NotionDashboardProviderOptions = {
  apiKey: string;
  databaseId: string;
};

export type NotionDashboardTarget = {
  id: string;
  mode: "data_source";
  titlePropertyName: string;
  existingProperties: Set<string>;
};

export type NotionPageUpsertInput = {
  episodeId: string;
  title: string;
  properties: Record<string, unknown>;
  children: CreatePageParameters["children"];
};

export class NotionDashboardProvider {
  private readonly client: Client;

  constructor(private readonly options: NotionDashboardProviderOptions) {
    this.client = new Client({ auth: options.apiKey });
  }

  async inspectTarget(): Promise<NotionDashboardTarget> {
    const dataSource = (await this.client.dataSources.retrieve({
      data_source_id: this.options.databaseId
    })) as { properties: Record<string, { type: string }> };

    return toTarget(this.options.databaseId, dataSource.properties);
  }

  async ensureSchema() {
    const target = await this.inspectTarget();
    const missing = notionDashboardSchema.filter((property) => {
      if (property.type === "title") {
        return false;
      }

      return !target.existingProperties.has(property.name);
    });
    const configurable = notionDashboardSchema.filter((property) => {
      if (property.type === "title" || !target.existingProperties.has(property.name)) {
        return false;
      }

      return property.type === "status" || property.type === "select";
    });
    const toUpdate = [...missing, ...configurable];

    if (toUpdate.length === 0) {
      return { target, addedProperties: [] as string[] };
    }

    const properties = Object.fromEntries(
      toUpdate.map((property) => [property.name, buildPropertySchema(property)])
    );

    await this.client.dataSources.update({
      data_source_id: target.id,
      properties
    });

    return {
      target: await this.inspectTarget(),
      addedProperties: missing.map((property) => property.name)
    };
  }

  async createDashboardDatabaseUnderPage(input: { pageId: string; title?: string }) {
    const title = input.title ?? "Music Channel Dashboard";
    const properties = Object.fromEntries(
      notionDashboardSchema
        .filter((property) => property.type !== "title")
        .map((property) => [property.name, buildPropertySchema(property)])
    );
    const response = (await this.client.databases.create({
      parent: {
        type: "page_id",
        page_id: input.pageId
      },
      title: [
        {
          type: "text",
          text: { content: title }
        }
      ],
      is_inline: true,
      initial_data_source: {
        properties
      }
    } as CreateDatabaseParameters)) as DatabaseObjectResponse;
    const dataSource = response.data_sources[0];

    if (!dataSource) {
      throw new Error("Notion created the dashboard database, but no data source was returned.");
    }

    return {
      databaseId: response.id,
      dataSourceId: dataSource.id,
      dataSourceName: dataSource.name,
      url: response.url
    };
  }

  async upsertEpisodePage(input: NotionPageUpsertInput) {
    const { target } = await this.ensureSchema();
    const existingPageId = await this.findEpisodePageId(target, input.episodeId);
    const properties = {
      ...input.properties,
      [target.titlePropertyName]: {
        title: [{ text: { content: input.title.slice(0, 2000) } }]
      }
    };

    if (existingPageId) {
      const updated = (await this.client.pages.update({
        page_id: existingPageId,
        properties
      } as UpdatePageParameters)) as PageObjectResponse;

      await this.appendSyncSummary(existingPageId, input.children);

      return {
        action: "updated" as const,
        pageId: updated.id,
        pageUrl: updated.url
      };
    }

    const created = (await this.client.pages.create({
      parent: { data_source_id: target.id },
      properties,
      children: input.children
    } as CreatePageParameters)) as PageObjectResponse;

    return {
      action: "created" as const,
      pageId: created.id,
      pageUrl: created.url
    };
  }

  private async findEpisodePageId(target: NotionDashboardTarget, episodeId: string) {
    const filter = {
      property: notionDashboardProperties.episodeId,
      rich_text: {
        equals: episodeId
      }
    };

    const query = (await this.client.dataSources.query({
      data_source_id: target.id,
      filter,
      page_size: 1
    } as QueryDataSourceParameters)) as { results: Array<{ id: string }> };

    return query.results[0]?.id;
  }

  private async appendSyncSummary(pageId: string, children: CreatePageParameters["children"]) {
    if (!children || children.length === 0) {
      return;
    }

    await this.client.blocks.children.append({
      block_id: pageId,
      children: [
        {
          object: "block",
          type: "divider",
          divider: {}
        },
        ...children.slice(0, 80)
      ]
    } as AppendBlockChildrenParameters);
  }
}

function toTarget(id: string, properties: Record<string, { type: string }>): NotionDashboardTarget {
  const titlePropertyName =
    Object.entries(properties).find(([, property]) => property.type === "title")?.[0] ??
    notionDashboardProperties.title;

  return {
    id,
    mode: "data_source",
    titlePropertyName,
    existingProperties: new Set(Object.keys(properties))
  };
}

function buildPropertySchema(property: NotionDashboardSchemaItem) {
  if (property.type === "rich_text") {
    return { type: "rich_text" as const, rich_text: {} };
  }

  if (property.type === "select") {
    const options = selectOptionsForProperty(property.name);

    return options
      ? { type: "select" as const, select: { options } }
      : { type: "select" as const, select: {} };
  }

  if (property.type === "status") {
    return {
      type: "status" as const,
      status: { options: selectOptions(Object.values(notionStatusMap)) }
    };
  }

  if (property.type === "number") {
    return { type: "number" as const, number: { format: "number" } };
  }

  if (property.type === "date") {
    return { type: "date" as const, date: {} };
  }

  return { type: "title" as const, title: {} };
}

function selectOptionsForProperty(name: string) {
  if (name === notionDashboardProperties.series) {
    return selectOptions(["Lunar Night Shift", "Deep Space Focus", "Midnight Terminal"]);
  }

  if (name === notionDashboardProperties.approval) {
    return selectOptions(Object.values(notionApprovalMap));
  }

  if (name === notionDashboardProperties.visibility) {
    return selectOptions(["private", "unlisted", "public"]);
  }

  return undefined;
}

function selectOptions(names: string[]) {
  const uniqueNames = [...new Set(names)];
  const colors = [
    "default",
    "blue",
    "green",
    "yellow",
    "orange",
    "red",
    "purple",
    "pink",
    "gray",
    "brown"
  ] as const;

  return uniqueNames.map((name, index) => ({
    name,
    color: colors[index % colors.length] ?? "default"
  }));
}
