# Notion Dashboard Setup

Create a Notion database or data source for episode operations, then share it with your Notion integration.

## Required Environment

```env
NOTION_API_KEY=
NOTION_DATABASE_ID=
```

`NOTION_DATABASE_ID` is kept as the local environment variable name, but with the current Notion API it should contain the target data source ID. A full Notion URL or a slug ending in the 32-character Notion ID is also accepted; the CLI normalizes it before calling the API.

## Required Properties

The CLI can add missing non-title properties with:

```bash
npm run notion:ensure-schema
```

Expected dashboard properties:

| Property | Type |
| --- | --- |
| Name | title |
| Episode ID | rich_text |
| Series | select |
| Status | status |
| Approval | select |
| Visibility | select |
| Runtime Minutes | number |
| Publish Date | date |
| Final Video Path | rich_text |
| Thumbnail Path | rich_text |
| Publish Package Path | rich_text |
| Preview Audio Path | rich_text |
| YouTube Title | rich_text |
| Last Synced At | date |

## Commands

Preview the payload without Notion credentials:

```bash
npm run notion:sync -- --episode-id 2026-05-04-lunar-night-shift-quiet-moonbase-systems --dry-run
```

Inspect the configured database/data source schema:

```bash
npm run notion:schema
```

If `NOTION_DATABASE_ID` points to a parent page instead of a data source, create the dashboard database under that page:

```bash
npm run notion:bootstrap
```

Then replace `NOTION_DATABASE_ID` with the returned `dataSourceId`.

Create or update the dashboard page:

```bash
npm run notion:sync -- --episode-id 2026-05-04-lunar-night-shift-quiet-moonbase-systems
```
