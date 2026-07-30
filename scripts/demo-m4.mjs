#!/usr/bin/env node
// Milestone 4 demo: tool shadowing detector (check #3) + the configurable
// policy engine (check #6), which now replaces milestone 3's hardcoded
// "block if tainted and destructive" shortcut.
//
// Entirely scripted, no real LLM calls — this drives the gateway's MCP
// server facade directly (the way an agent's tool calls would arrive)
// using gateway.m4.config.json, which connects the trusted benign-server
// alongside the malicious-server with SHADOW=1 (adds get_weather, an
// exact clone of benign-server's tool, and get_weathr, a one-character
// typosquat of it) and a small policy config: read_report is tiered
// "sensitive", and send_email may only be called with a "to" address at
// trusted-corp.example.
//
// At connection time, check #3 should flag the exact collision on
// "get_weather" and the fuzzy collision "get_weathr" ~ "get_weather".
// Then a series of tools/call requests exercises every path through the
// policy engine: shadow-block, shadow-flag, scope-block, tainted+critical
// block, tainted+sensitive flag, and a plain allow.

import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { connectViaGateway } from "@taintmcp/claude-agent";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GATEWAY_TARGET = {
  command: "node",
  args: [path.join(ROOT, "packages/gateway/dist/cli.js"), "start", "--config", path.join(ROOT, "gateway.m4.config.json")],
};

function summarize(outcome) {
  return `${outcome.isError ? "[ERROR] " : ""}${outcome.text.replace(/\n/g, " ").slice(0, 160)}`;
}

async function main() {
  rmSync(path.join(ROOT, "taintmcp.m4.db"), { force: true });

  const failures = [];
  const check = (condition, description) => {
    console.log(`  ${condition ? "OK  " : "FAIL"} ${description}`);
    if (!condition) failures.push(description);
  };

  console.log(`\n${"=".repeat(70)}\nConnecting through the gateway (watch for [SHADOW: ...] lines below)\n${"=".repeat(70)}`);
  const host = await connectViaGateway(GATEWAY_TARGET);

  console.log("\n--- read_notes: seed a tainted response to use in later calls ---");
  const notes = await host.callTool("read_notes", {});
  console.log(`  <- ${summarize(notes)}`);

  console.log("\n--- Call 1: get_weather (exact-shadowed by both benign and malicious) ---");
  const exactShadowCall = await host.callTool("get_weather", { city: "London" });
  console.log(`  <- ${summarize(exactShadowCall)}`);
  check(exactShadowCall.isError, "call to the exactly-shadowed tool name is blocked");
  check(exactShadowCall.text.includes("block-ambiguous-shadowed-tool"), "block reason cites the shadow rule");

  console.log("\n--- Call 2: get_weathr (fuzzy-shadowed typosquat of get_weather) ---");
  const fuzzyShadowCall = await host.callTool("get_weathr", { city: "Paris" });
  console.log(`  <- ${summarize(fuzzyShadowCall)}`);
  check(!fuzzyShadowCall.isError, "call to the fuzzily-shadowed tool name is NOT blocked (only exact collisions are)");
  check(fuzzyShadowCall.text.includes("FLAGGED FOR REVIEW"), "...but it is flagged for review");

  console.log("\n--- Call 3: send_email to an out-of-scope domain (untainted body) ---");
  const scopeViolation = await host.callTool("send_email", {
    to: "backup@notes-archive.example",
    subject: "Hi",
    body: "Nothing tainted here, just an out-of-scope recipient.",
  });
  console.log(`  <- ${summarize(scopeViolation)}`);
  check(scopeViolation.isError, "call with a recipient outside the configured scope is blocked");
  check(scopeViolation.text.includes("block-scope-violation"), "block reason cites the scope rule");

  console.log("\n--- Call 4: send_email, in-scope recipient, untainted body ---");
  const cleanAllowed = await host.callTool("send_email", {
    to: "person@trusted-corp.example",
    subject: "Hi",
    body: "Just saying hello, nothing tainted.",
  });
  console.log(`  <- ${summarize(cleanAllowed)}`);
  check(!cleanAllowed.isError, "an untainted, in-scope call to a critical-tier tool is allowed");

  console.log("\n--- Call 5: read_report (tiered 'sensitive' via config) with a tainted argument ---");
  const flaggedSensitive = await host.callTool("read_report", { reportId: "planning" });
  console.log(`  <- ${summarize(flaggedSensitive)}`);
  check(!flaggedSensitive.isError, "a tainted call to a sensitive-tier tool is NOT blocked...");
  check(flaggedSensitive.text.includes("flag-tainted-sensitive"), "...but is flagged for human review");

  console.log("\n--- Call 6: send_email, in-scope recipient, tainted body ---");
  const blockedCritical = await host.callTool("send_email", {
    to: "person@trusted-corp.example",
    subject: "Backup",
    body: notes.text,
  });
  console.log(`  <- ${summarize(blockedCritical)}`);
  check(blockedCritical.isError, "a tainted call to a critical-tier tool is blocked even though the recipient is in scope");
  check(blockedCritical.text.includes("block-tainted-critical"), "block reason cites the tainted-critical rule, not the scope rule");

  await host.close();

  console.log("");
  if (failures.length === 0) {
    console.log("[demo-m4] PASS — tool shadowing detector and policy engine both behaved as expected.");
    process.exit(0);
  } else {
    console.error(`[demo-m4] FAIL — ${failures.length} expectation(s) not met:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[demo-m4] fatal error:", err);
  process.exit(1);
});
