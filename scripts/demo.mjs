#!/usr/bin/env node
// Milestone 1 end-to-end demo / verification script.
//
// Spawns, in order:
//   1. the benign fixture server (get_weather), listening on :3200
//   2. the taintmcp gateway, listening on :3100, proxying to (1)
//   3. the scripted mock agent, which connects to (2), lists tools, and
//      calls get_weather — proving the full round trip works.
//
// Exits 0 if the mock agent's round trip succeeds, non-zero otherwise.
// No real LLM calls are made anywhere in this flow.

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";

function startProcess(label, command, args, opts, readySubstring) {
  const child = spawn(command, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
  let ready = false;
  let readyResolve;
  const readyPromise = new Promise((resolve) => {
    readyResolve = resolve;
  });

  const onData = (buf) => {
    const text = buf.toString();
    process.stdout.write(text);
    if (!ready && text.includes(readySubstring)) {
      ready = true;
      readyResolve();
    }
  };

  child.stdout.on("data", onData);
  child.stderr.on("data", (buf) => process.stderr.write(buf.toString()));
  child.on("exit", (code, signal) => {
    if (!ready) {
      readyResolve(); // unblock waiter; caller will notice the process is dead
    }
    if (code !== null && code !== 0) {
      console.error(`[demo] ${label} exited early with code ${code}`);
    } else if (signal) {
      console.error(`[demo] ${label} was killed with signal ${signal}`);
    }
  });

  return { child, waitUntilReady: () => Promise.race([readyPromise, delay(10_000).then(() => { throw new Error(`${label} did not become ready within 10s`); })]) };
}

async function main() {
  const benign = startProcess(
    "benign-server",
    "node",
    ["packages/benign-server/dist/index.js"],
    { cwd: ROOT, env: { ...process.env, PORT: "3200" } },
    "listening on",
  );
  await benign.waitUntilReady();

  const gateway = startProcess(
    "gateway",
    "node",
    ["packages/gateway/dist/cli.js", "start", "--config", "gateway.config.json"],
    { cwd: ROOT, env: process.env },
    "listening as an MCP server",
  );
  await gateway.waitUntilReady();

  console.log("[demo] both servers are up; running the scripted mock agent...\n");

  const agentExitCode = await new Promise((resolve) => {
    const agent = spawn("node", ["packages/mock-agent/dist/index.js"], {
      cwd: ROOT,
      env: { ...process.env, GATEWAY_URL: "http://localhost:3100/mcp" },
      stdio: "inherit",
    });
    agent.on("exit", (code) => resolve(code ?? 1));
  });

  benign.child.kill();
  gateway.child.kill();

  if (agentExitCode === 0) {
    console.log("\n[demo] PASS — full round trip (agent -> gateway -> benign server -> gateway -> agent) succeeded.");
  } else {
    console.error("\n[demo] FAIL — mock agent reported an error, see output above.");
  }
  process.exit(agentExitCode);
}

main().catch((err) => {
  console.error("[demo] fatal error:", err);
  process.exit(1);
});
