#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const configPath = path.join(root, "fork/no-telemetry-guard.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const args = new Set(process.argv.slice(2));
const strict = args.has("--strict") || config.strict === true;
const scanDist = args.has("--dist");

const read = (file) => {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, "utf8");
};

const lineOf = (content, pattern) => {
  const regex = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    regex.lastIndex = 0;
    if (regex.test(lines[i])) return i + 1;
  }
  return null;
};

const fileCheck = (id, phase, file, required = [], forbidden = []) => () => {
  const content = read(file);
  if (content === null) return [`${file}: missing`];
  const issues = [];
  for (const pattern of required) {
    if (!pattern.test(content)) issues.push(`${file}: missing ${pattern}`);
  }
  for (const pattern of forbidden) {
    const line = lineOf(content, pattern);
    if (line !== null) issues.push(`${file}:${line}: still contains ${pattern}`);
  }
  return issues;
};

const walk = (dir, output = []) => {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return output;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith("dist-")) continue;
    if (entry.name === ".repos" || entry.name === "fixtures" || entry.name === "translations") continue;
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(relative, output);
      continue;
    }
    if (!/\.(?:ts|tsx|js|mjs|cjs|json)$/u.test(entry.name)) continue;
    if (/\.(?:test|spec)\./u.test(entry.name) || entry.name.endsWith(".d.ts")) continue;
    output.push(relative);
  }
  return output;
};

const literalScan = (dirs, patterns) => () => {
  const regexes = patterns.map((pattern) => new RegExp(pattern, "g"));
  const issues = [];
  for (const file of dirs.flatMap((dir) => walk(dir))) {
    const content = read(file);
    for (const regex of regexes) {
      const line = lineOf(content, regex);
      if (line !== null) issues.push(`${file}:${line}: forbidden ${regex}`);
    }
  }
  return issues;
};

const builtScan = () => {
  const patterns = config.forbiddenBuiltPatterns.map((pattern) => new RegExp(pattern, "g"));
  const dirs = ["apps/web/dist", "apps/server/dist", "apps/desktop/dist", "apps/desktop/dist-electron"];
  const issues = [];
  for (const dir of dirs) {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) continue;
    const entries = [];
    const visit = (entry) => {
      for (const item of fs.readdirSync(entry, { withFileTypes: true })) {
        const itemPath = path.join(entry, item.name);
        if (item.isDirectory()) visit(itemPath);
        else entries.push(itemPath);
      }
    };
    visit(full);
    for (const entry of entries) {
      const content = fs.readFileSync(entry, "utf8");
      for (const regex of patterns) {
        const line = lineOf(content, regex);
        if (line !== null) issues.push(`${path.relative(root, entry)}:${line}: forbidden ${regex}`);
      }
    }
  }
  return issues;
};

const checks = [
  {
    id: "feedback-capability-disabled",
    phase: "current",
    run: fileCheck(
      "feedback-capability-disabled",
      "current",
      "apps/server/src/environment/ServerEnvironment.ts",
      [/\bagentFeedback:\s*false\b/],
      [/\bagentFeedback:\s*true\b/],
    ),
  },
  {
    id: "feedback-mcp-tool-hidden",
    phase: "current",
    run: fileCheck(
      "feedback-mcp-tool-hidden",
      "current",
      "apps/server/src/mcp/McpInvocationContext.ts",
      [/export const hiddenWhileFeedbackOff = \(\): boolean => false;/],
      [/scope\?\.agentFeedback/u],
    ),
  },
  {
    id: "feedback-cli-removed",
    phase: "current",
    run: fileCheck(
      "feedback-cli-removed",
      "current",
      "apps/server/src/binCli.ts",
      [],
      [/feedbackCommand/u],
    ),
  },
  {
    id: "feedback-cli-command-list-synced",
    phase: "current",
    run: fileCheck(
      "feedback-cli-command-list-synced",
      "current",
      "apps/server/src/feedback/FeedbackReport.ts",
      [],
      [/["']t3 feedback(?: list)?["']/u],
    ),
  },
  {
    id: "analytics-service-no-op",
    phase: "planned",
    run: fileCheck(
      "analytics-service-no-op",
      "planned",
      "apps/server/src/telemetry/AnalyticsService.ts",
      [/\blayer\s*=\s*Layer\.succeed\(AnalyticsService/u],
      [/\bgetTelemetryIdentity\b/u, /HttpClientRequest\.post/u, /T3CODE_TELEMETRY_KEY/u, /ingest\.t3\.codes/u],
    ),
  },
  {
    id: "server-owner-read-removed",
    phase: "planned",
    run: fileCheck(
      "server-owner-read-removed",
      "planned",
      "apps/server/src/serverRuntimeStartup.ts",
      [],
      [/getServerOwners/u, /recordOwners/u],
    ),
  },
  {
    id: "client-owner-params-removed",
    phase: "planned",
    run: fileCheck(
      "client-owner-params-removed",
      "planned",
      "packages/client-runtime/src/authorization/remote.ts",
      [],
      [/readClientOwnerParams/u, /clientOwner/u, /clientDevice/u],
    ),
  },
  {
    id: "client-owner-params-removed-direct",
    phase: "planned",
    run: fileCheck(
      "client-owner-params-removed-direct",
      "planned",
      "packages/client-runtime/src/connection/resolver.ts",
      [],
      [/clientOwner/u, /clientDevice/u],
    ),
  },
  {
    id: "relay-tracing-disabled",
    phase: "planned",
    run: fileCheck(
      "relay-tracing-disabled",
      "planned",
      "packages/shared/src/relayTracing.ts",
      [/Layer\.succeed\(RelayClientTracer,\s*Option\.none\(\)\)/u],
      [/OtlpTracer\.layer/u, /X-Axiom-Dataset/u],
    ),
  },
  {
    id: "browser-otlp-exporter-removed",
    phase: "planned",
    run: fileCheck(
      "browser-otlp-exporter-removed",
      "planned",
      "apps/web/src/observability/clientTracing.ts",
      [],
      [/OtlpTracer\.make/u, /v1\/traces/u],
    ),
  },
  {
    id: "mobile-observe-removed",
    phase: "planned",
    run: fileCheck(
      "mobile-observe-removed",
      "planned",
      "apps/mobile/package.json",
      [],
      [/expo-observe/u],
    ),
  },
  {
    id: "no-forbidden-source-literals",
    phase: "planned",
    run: literalScan(["apps", "packages", "infra"], config.forbiddenSourcePatterns),
  },
];

if (scanDist) {
  checks.push({ id: "no-forbidden-built-literals", phase: "planned", run: builtScan });
}

const failed = [];
const pending = [];
for (const check of checks) {
  const enforced = strict || check.phase === "current";
  const issues = check.run();
  if (issues.length === 0) {
    console.log(`PASS  ${check.id}`);
    continue;
  }
  if (!enforced) {
    pending.push(check.id);
    console.log(`TODO  ${check.id} (planned; not blocking until strict mode)`);
    continue;
  }
  failed.push(check.id);
  console.error(`FAIL  ${check.id}`);
  for (const issue of issues) console.error(`      ${issue}`);
}

if (pending.length > 0) {
  console.log(`\n${pending.length} planned check(s) are not enforced yet. Set fork/no-telemetry-guard.json strict=true after all phases land.`);
}

if (failed.length > 0) {
  console.error(`\n${failed.length} fork invariant check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log(`\nNo-telemetry guard passed (${strict ? "strict" : "current"} profile).`);
}
