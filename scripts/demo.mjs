#!/usr/bin/env node
// Milestone 1 end-to-end demo / verification script.
//
// Runs the scripted mock agent, which:
//   1. spawns the taintmcp gateway as a child process over stdio
//   2. the gateway, in turn, spawns the benign get_weather fixture server
//      as its own child process over stdio and connects to it as an MCP
//      client
//   3. the mock agent lists the tools the gateway exposes and calls
//      get_weather, proving the full round trip
//      (agent -> gateway -> benign server -> gateway -> agent) works.
//
// Exits 0 if the mock agent's round trip succeeds, non-zero otherwise.
// No real LLM calls are made anywhere in this flow — everything is local
// child processes talking JSON-RPC over stdio.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const exitCode = await new Promise((resolve) => {
    const agent = spawn("node", ["packages/mock-agent/dist/index.js"], {
      cwd: ROOT,
      env: process.env,
      stdio: "inherit",
    });
    agent.on("exit", (code) => resolve(code ?? 1));
  });

  if (exitCode === 0) {
    console.log("\n[demo] PASS — full round trip (agent -> gateway -> benign server -> gateway -> agent) succeeded.");
  } else {
    console.error("\n[demo] FAIL — mock agent reported an error, see output above.");
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[demo] fatal error:", err);
  process.exit(1);
});
