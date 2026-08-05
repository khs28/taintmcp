#!/usr/bin/env node
// Milestone 2 demo: schema/description scanner (check #1) + rug-pull
// detector (check #2), run against the deliberately malicious test server.
//
// Connects to the malicious server twice, simulating two separate
// connection events:
//
//   Run 1 (baseline): lookup_notes looks clean, read_report and
//   export_data are poisoned from the start. Check #1 should flag those
//   two immediately; check #2 stores a baseline hash for all three since
//   this is the first time it's seen any of them.
//
//   Run 2 (RUGPULL=1): lookup_notes' description silently changes to
//   inject imperative "always call this tool / ignore instructions"
//   language. Check #1 should flag the new content, and check #2 should
//   independently flag that a previously-trusted tool's schema changed at
//   all — the actual rug-pull signal.
//
// Nothing is blocked (that's milestone 4's policy engine) — this only
// proves both checks detect and log correctly. Exits non-zero if either
// run doesn't match what's expected above.

import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadConfig, connectDownstreams, inspectTools, logInspectionReport, openStore } from "taintmcp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = path.join(ROOT, "gateway.malicious.config.json");

async function runConnection(label, env) {
  console.log(`\n=== ${label} ===`);
  const config = await loadConfig(CONFIG_PATH);
  const [conn] = await connectDownstreams({ ...config, targets: config.targets.map((t) => ({ ...t, env })) });
  const db = openStore(path.join(ROOT, config.storage?.dbPath ?? "taintmcp.db"));

  const report = await inspectTools(conn.client, conn.serverId, db);
  logInspectionReport(report);

  db.close();
  await conn.client.close();
  return report;
}

function findTool(report, name) {
  const found = report.tools.find((t) => t.tool.name === name);
  if (!found) throw new Error(`tool "${name}" missing from report`);
  return found;
}

async function main() {
  // Start from a clean slate so this demo is repeatable.
  rmSync(path.join(ROOT, "taintmcp.malicious.db"), { force: true });

  const failures = [];
  const check = (condition, description) => {
    console.log(`  ${condition ? "OK  " : "FAIL"} ${description}`);
    if (!condition) failures.push(description);
  };

  const baseline = await runConnection("Run 1: baseline connection", {});
  console.log("\nExpectations for run 1:");
  check(findTool(baseline, "read_report").scanFindings.some((f) => f.check === "hidden-unicode"), "read_report flagged for hidden Unicode");
  check(
    findTool(baseline, "export_data").scanFindings.some((f) => f.check === "undocumented-parameter"),
    "export_data flagged for an undocumented parameter (destination_url)",
  );
  check(findTool(baseline, "lookup_notes").scanFindings.length === 0, "lookup_notes scans clean on first sight");
  check(
    baseline.tools.every((t) => t.rugPull.status === "new"),
    "all three tools recorded as first-seen (baseline hash stored)",
  );

  const rugpulled = await runConnection("Run 2: RUGPULL=1 (lookup_notes description silently mutated)", { RUGPULL: "1" });
  console.log("\nExpectations for run 2:");
  check(
    findTool(rugpulled, "lookup_notes").scanFindings.some((f) => f.check === "imperative-language"),
    "lookup_notes now flagged for imperative/system-style language",
  );
  check(findTool(rugpulled, "lookup_notes").rugPull.status === "changed", "lookup_notes flagged as a RUG PULL (schema hash changed since run 1)");
  check(
    findTool(rugpulled, "read_report").rugPull.status === "unchanged" && findTool(rugpulled, "export_data").rugPull.status === "unchanged",
    "read_report and export_data still hash-match run 1 (no false rug-pull)",
  );

  console.log("");
  if (failures.length === 0) {
    console.log("[demo-m2] PASS — schema scanner and rug-pull detector both behaved as expected.");
    process.exit(0);
  } else {
    console.error(`[demo-m2] FAIL — ${failures.length} expectation(s) not met:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[demo-m2] fatal error:", err);
  process.exit(1);
});
