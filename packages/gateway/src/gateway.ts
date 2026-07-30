import type { DatabaseSync } from "node:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import type { GatewayConfig } from "./config.js";
import { checkRugPull, type RugPullResult } from "./rugpull.js";
import { scanTool, type ScanFinding } from "./scanner.js";
import { openStore } from "./storage.js";

const DEFAULT_DB_PATH = "taintmcp.db";

export interface RunningGateway {
  close: () => Promise<void>;
}

export interface ToolInspection {
  tool: Tool;
  scanFindings: ScanFinding[];
  rugPull: RugPullResult;
}

export interface InspectionReport {
  serverId: string;
  tools: ToolInspection[];
}

/** Connects as an MCP client to the configured downstream server over stdio. */
export async function connectDownstream(config: GatewayConfig): Promise<Client> {
  const client = new Client({ name: "taintmcp-gateway", version: "0.1.0" });
  const env = Object.fromEntries(
    Object.entries({ ...process.env, ...config.target.env }).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const transport = new StdioClientTransport({
    command: config.target.command,
    args: config.target.args,
    env,
  });
  await client.connect(transport);
  return client;
}

/** A stable-ish identity for the downstream server, used as the rug-pull detector's storage key. */
export function deriveServerId(client: Client, config: GatewayConfig): string {
  return client.getServerVersion()?.name ?? `${config.target.command} ${config.target.args.join(" ")}`;
}

/**
 * Checks #1 and #2: runs the schema/description scanner and the rug-pull
 * detector over every tool the downstream server currently reports. This
 * happens once, at connection time, before any of these tools are ever
 * exposed to the agent — matching how the brief scopes both checks.
 */
export async function inspectTools(client: Client, serverId: string, db: DatabaseSync): Promise<InspectionReport> {
  const { tools } = await client.listTools();
  const inspections: ToolInspection[] = tools.map((tool) => ({
    tool,
    scanFindings: scanTool(tool),
    rugPull: checkRugPull(db, serverId, tool),
  }));
  return { serverId, tools: inspections };
}

export function logInspectionReport(report: InspectionReport): void {
  console.error(`[gateway] inspected ${report.tools.length} tool(s) from server "${report.serverId}"`);
  for (const { tool, scanFindings, rugPull } of report.tools) {
    if (scanFindings.length === 0) {
      console.error(`[gateway]   ${tool.name}: schema scan clean`);
    }
    for (const finding of scanFindings) {
      console.error(`[gateway]   ${tool.name}: [FLAGGED: ${finding.check}] ${finding.detail}`);
    }

    if (rugPull.status === "new") {
      console.error(`[gateway]   ${tool.name}: first connection, baseline schema hash stored (${rugPull.currentHash.slice(0, 12)}…)`);
    } else if (rugPull.status === "unchanged") {
      console.error(`[gateway]   ${tool.name}: schema unchanged since last connection (${rugPull.currentHash.slice(0, 12)}…)`);
    } else {
      console.error(
        `[gateway]   ${tool.name}: [RUG PULL DETECTED] schema/description changed since it was last trusted (${rugPull.previousHash?.slice(0, 12)}… -> ${rugPull.currentHash.slice(0, 12)}…)`,
      );
    }
  }
}

/**
 * Milestone 2 adds checks #1 and #2 as pure detect-and-log: every finding
 * above is still forwarded to the agent unmodified. Blocking/flagging
 * decisions based on these findings are the policy engine's job
 * (milestone 4) — this milestone only proves the checks themselves work.
 */
export async function startGateway(config: GatewayConfig): Promise<RunningGateway> {
  const db = openStore(config.storage?.dbPath ?? DEFAULT_DB_PATH);
  const downstream = await connectDownstream(config);
  console.error(
    `[gateway] connected as client to downstream MCP server (${config.target.command} ${config.target.args.join(" ")})`,
  );

  const serverId = deriveServerId(downstream, config);
  const report = await inspectTools(downstream, serverId, db);
  logInspectionReport(report);

  const server = new Server({ name: "taintmcp-gateway", version: "0.1.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return downstream.listTools();
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return downstream.callTool(request.params);
  });

  // This process is itself spawned over stdio by whatever connects to the
  // gateway (the mock agent, in milestone 1), so its own stdin/stdout are
  // reserved for that JSON-RPC stream. All logging above and below goes to
  // stderr instead.
  const serverTransport = new StdioServerTransport();
  await server.connect(serverTransport);
  console.error("[gateway] ready as an MCP server on stdio");

  return {
    close: async () => {
      await server.close();
      await downstream.close();
      db.close();
    },
  };
}
