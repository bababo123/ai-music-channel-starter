#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const packagePath = join(root, "package.json");
const envPath = join(root, ".env");
const envExamplePath = join(root, ".env.example");

const checks = [];

function addCheck(name, status, detail = "") {
  checks.push({ name, status, detail });
}

function commandVersion(command, args = ["--version"]) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true
  });

  if (result.error) {
    return { ok: false, detail: result.error.message };
  }

  const output = `${result.stdout || ""}${result.stderr || ""}`.trim().split(/\r?\n/)[0] || `exit ${result.status}`;
  return { ok: result.status === 0, detail: output };
}

function parseDotEnv(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const result = {};
  const content = readFileSync(filePath, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);

    if (!match) {
      continue;
    }

    result[match[1]] = match[2].trim();
  }

  return result;
}

function hasValue(env, key) {
  return typeof env[key] === "string" && env[key].length > 0;
}

function requireScripts(packageJson, names) {
  const scripts = packageJson.scripts || {};

  for (const name of names) {
    addCheck(`npm script: ${name}`, scripts[name] ? "ok" : "missing", scripts[name] || "");
  }
}

addCheck("project root", existsSync(packagePath) ? "ok" : "missing", packagePath);
addCheck(".env.example", existsSync(envExamplePath) ? "ok" : "missing", envExamplePath);
addCheck(".env", existsSync(envPath) ? "ok" : "missing", envPath);

const nodeMajor = Number(process.versions.node.split(".")[0]);
addCheck("Node.js", nodeMajor >= 22 ? "ok" : "warn", process.version);

const ffmpeg = commandVersion("ffmpeg", ["-version"]);
addCheck("ffmpeg", ffmpeg.ok ? "ok" : "missing", ffmpeg.detail);

const ffprobe = commandVersion("ffprobe", ["-version"]);
addCheck("ffprobe", ffprobe.ok ? "ok" : "missing", ffprobe.detail);

if (existsSync(packagePath)) {
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  addCheck("package name", packageJson.name ? "ok" : "warn", packageJson.name || "missing name");
  requireScripts(packageJson, [
    "db:migrate",
    "episode:create",
    "episode:generate",
    "audio:qc",
    "audio:mix",
    "image:import-codex",
    "youtube:package",
    "episode:approve",
    "youtube:upload",
    "youtube:track-performance"
  ]);
}

const env = parseDotEnv(envPath);
const envGroups = [
  ["MiniMax music", ["MINIMAX_API_KEY"]],
  ["OpenAI image optional", ["OPENAI_API_KEY"]],
  ["Notion dashboard", ["NOTION_API_KEY", "NOTION_DATABASE_ID"]],
  ["YouTube OAuth", ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"]],
  ["YouTube channel", ["YOUTUBE_ACTIVE_CHANNEL", "YOUTUBE_CHANNELS_JSON"]]
];

for (const [group, keys] of envGroups) {
  const present = keys.filter((key) => hasValue(env, key));
  const missing = keys.filter((key) => !hasValue(env, key));
  addCheck(
    `env group: ${group}`,
    missing.length === 0 ? "ok" : present.length > 0 ? "warn" : "missing",
    `present ${present.length}/${keys.length}${missing.length ? `, missing ${missing.join(", ")}` : ""}`
  );
}

const dbPath = resolve(root, env.DB_PATH || "data/music-channel.sqlite");
addCheck("SQLite database", existsSync(dbPath) ? "ok" : "missing", dbPath);

const totals = checks.reduce(
  (acc, check) => {
    acc[check.status] = (acc[check.status] || 0) + 1;
    return acc;
  },
  {}
);

console.log("AI Music Channel Project Doctor");
console.log(`Root: ${root}`);
console.log("");

for (const check of checks) {
  const marker = check.status === "ok" ? "OK" : check.status === "warn" ? "WARN" : "MISSING";
  console.log(`${marker.padEnd(7)} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
}

console.log("");
console.log(`Summary: ${totals.ok || 0} ok, ${totals.warn || 0} warnings, ${totals.missing || 0} missing`);

if (totals.missing || totals.warn) {
  console.log("");
  console.log("Next: fill .env for the services you want to use, install missing tools, then rerun this doctor.");
  console.log("Do not paste secrets into chat. Store them in .env.");
}

