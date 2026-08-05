#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { Command } from "commander";
import { loadConfig, type GatewayConfig } from "./config.js";
import { startGateway } from "./gateway.js";

const program = new Command();

program
  .name("taintmcp")
  .description("taintmcp: a runtime, client-side security gateway for MCP")
  .version("0.1.0");

program
  .command("start")
  .description("Start the gateway in front of one or more MCP servers, using a config file")
  .requiredOption("-c, --config <path>", "Path to a gateway config JSON file")
  .action(async (opts: { config: string }) => {
    const config = await loadConfig(opts.config);
    await startGateway(config);
  });

// The no-config-file path: wraps a single MCP server command directly, the
// same way you'd normally launch it. Everything after the literal "--" is
// passed straight through as the wrapped server's own command and
// arguments, untouched, so taintmcp's own flags never collide with the
// wrapped server's.
program
  .command("wrap")
  .description("Start the gateway in front of a single MCP server, no config file needed")
  .argument("<command...>", "the command that starts your MCP server, after a -- separator")
  .option("-d, --db <path>", "SQLite database path for logs", "taintmcp.db")
  .action(async (commandParts: string[], opts: { db: string }) => {
    const [command, ...args] = commandParts;
    if (!command) {
      console.error('[gateway] usage: taintmcp wrap -- <command> [args...]  (for example: taintmcp wrap -- node my-server.js)');
      process.exit(1);
    }
    const config: GatewayConfig = {
      targets: [{ id: "wrapped", command, args }],
      storage: { dbPath: opts.db },
    };
    await startGateway(config);
  });

const CONFIG_TEMPLATE = `{
  "targets": [
    {
      "id": "my-server",
      "command": "node",
      "args": ["/absolute/path/to/your/mcp-server/index.js"]
    }
  ],
  "storage": {
    "dbPath": "taintmcp.db"
  },
  "policy": {
    "tiers": {
      "some_sensitive_tool": "critical"
    },
    "scopeRules": [
      { "tool": "send_email", "param": "to", "allow": "^[\\\\w.+-]+@yourcompany\\\\.com$" }
    ]
  }
}
`;

program
  .command("init")
  .description("Write a starter gateway config file for editing (multiple servers, custom policy rules)")
  .option("-o, --out <path>", "output path", "taintmcp.config.json")
  .action(async (opts: { out: string }) => {
    await writeFile(opts.out, CONFIG_TEMPLATE);
    console.log(`[gateway] wrote ${opts.out}. Edit the "targets" array to point at your real MCP server(s), then run:`);
    console.log(`  taintmcp start --config ${opts.out}`);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error("[gateway] fatal error:", err);
  process.exit(1);
});
