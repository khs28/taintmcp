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

// The no-config-file path: wraps a single MCP server directly, the same way
// you'd normally launch or point a client at it. Either give a local command
// after a "--" separator (passed straight through untouched, so taintmcp's
// own flags never collide with the wrapped server's), or give --url to
// protect a remote HTTP/SSE MCP server instead.
function parseHeaders(headerFlags: string[] | undefined): Record<string, string> | undefined {
  if (!headerFlags || headerFlags.length === 0) return undefined;
  const headers: Record<string, string> = {};
  for (const flag of headerFlags) {
    const separatorIndex = flag.indexOf(":");
    if (separatorIndex === -1) {
      console.error(`[gateway] invalid --header "${flag}", expected format "Key: Value"`);
      process.exit(1);
    }
    const key = flag.slice(0, separatorIndex).trim();
    const value = flag.slice(separatorIndex + 1).trim();
    headers[key] = value;
  }
  return headers;
}

program
  .command("wrap")
  .description("Start the gateway in front of a single MCP server (local command or remote URL), no config file needed")
  .argument("[command...]", "the command that starts your MCP server, after a -- separator (omit this if using --url)")
  .option("-d, --db <path>", "SQLite database path for logs", "taintmcp.db")
  .option("-u, --url <url>", "URL of a remote MCP server to protect (Streamable HTTP or SSE), instead of a local command")
  .option("-H, --header <header...>", 'extra HTTP header to send to the remote server, format "Key: Value" (repeatable, requires --url)')
  .action(async (commandParts: string[], opts: { db: string; url?: string; header?: string[] }) => {
    let target: GatewayConfig["targets"][number];
    if (opts.url) {
      target = { id: "wrapped", url: opts.url, headers: parseHeaders(opts.header), args: [], transport: "auto" };
    } else {
      const [command, ...args] = commandParts;
      if (!command) {
        console.error(
          "[gateway] usage: taintmcp wrap -- <command> [args...]  (for example: taintmcp wrap -- node my-server.js)\n" +
            "       or:     taintmcp wrap --url <http-url>  (for example: taintmcp wrap --url https://example.com/mcp)",
        );
        process.exit(1);
      }
      target = { id: "wrapped", command, args, transport: "auto" };
    }
    const config: GatewayConfig = {
      targets: [target],
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
