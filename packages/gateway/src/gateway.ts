import type { DatabaseSync } from "node:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import type { GatewayConfig, TargetConfig } from "./config.js";
import {
  checkCallProvenance,
  extractResponseText,
  generateProvenanceId,
  wrapWithProvenance,
  type TaintedResponse,
} from "./provenance.js";
import { checkRugPull, type RugPullResult } from "./rugpull.js";
import { scanTool, type ScanFinding } from "./scanner.js";
import { insertPolicyDecision, insertProvenanceLog, openStore } from "./storage.js";

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

export interface DownstreamConnection {
  id: string;
  client: Client;
  serverId: string;
}

function mergeEnv(target: TargetConfig): Record<string, string> {
  return Object.fromEntries(
    Object.entries({ ...process.env, ...target.env }).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

/** Connects as an MCP client to every configured downstream target over stdio. */
export async function connectDownstreams(config: GatewayConfig): Promise<DownstreamConnection[]> {
  const connections: DownstreamConnection[] = [];
  for (const target of config.targets) {
    const client = new Client({ name: "taintmcp-gateway", version: "0.1.0" });
    const transport = new StdioClientTransport({
      command: target.command,
      args: target.args,
      env: mergeEnv(target),
    });
    await client.connect(transport);
    const serverId = client.getServerVersion()?.name ?? target.id;
    connections.push({ id: target.id, client, serverId });
  }
  return connections;
}

/**
 * Checks #1 and #2: runs the schema/description scanner and the rug-pull
 * detector over every tool a downstream server currently reports. This
 * happens once per server, at connection time, before any of these tools
 * are ever exposed to the agent.
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
 * Milestone 3 adds check #4 (output tainting + provenance tracking) and a
 * minimal hardcoded policy: block a call if its arguments trace back to
 * tainted content AND the target tool is marked destructive/sensitive
 * (annotations.destructiveHint). The real configurable policy engine
 * (check #6) is milestone 4 — this is just enough to prove tainting and
 * provenance tracking work end to end.
 */
export async function startGateway(config: GatewayConfig): Promise<RunningGateway> {
  const db = openStore(config.storage?.dbPath ?? DEFAULT_DB_PATH);
  const connections = await connectDownstreams(config);
  for (const conn of connections) {
    console.error(`[gateway] connected as client to downstream MCP server "${conn.id}" (reports itself as "${conn.serverId}")`);
    const report = await inspectTools(conn.client, conn.serverId, db);
    logInspectionReport(report);
  }

  // Routes an incoming tool name to whichever downstream connection
  // reported it. Milestone 4's tool-shadowing detector is what's supposed
  // to catch name collisions across servers — for now the last server
  // registered for a given name silently wins.
  const toolOwner = new Map<string, DownstreamConnection>();
  const toolByName = new Map<string, Tool>();
  for (const conn of connections) {
    const { tools } = await conn.client.listTools();
    for (const tool of tools) {
      toolOwner.set(tool.name, conn);
      toolByName.set(tool.name, tool);
    }
  }

  const taintStore: TaintedResponse[] = [];

  const server = new Server({ name: "taintmcp-gateway", version: "0.1.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const allTools: Tool[] = [];
    for (const conn of connections) {
      const { tools } = await conn.client.listTools();
      allTools.push(...tools);
    }
    return { tools: allTools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const conn = toolOwner.get(name);
    if (!conn) {
      throw new Error(`taintmcp gateway: no connected server owns tool "${name}"`);
    }

    const taintCheck = checkCallProvenance(args, taintStore);
    insertProvenanceLog(db, {
      provenanceId: generateProvenanceId(),
      serverId: conn.serverId,
      toolName: name,
      direction: "call",
      tainted: taintCheck.tainted ? 1 : 0,
      sourceProvenanceIds: JSON.stringify(taintCheck.matchedProvenanceIds),
      content: JSON.stringify(args ?? {}),
    });

    const targetTool = toolByName.get(name);
    const isSensitive = targetTool?.annotations?.destructiveHint === true;

    if (taintCheck.tainted && isSensitive) {
      const reason = `call to sensitive tool "${name}" contains content traced back to untrusted provenance ${taintCheck.matchedProvenanceIds.join(", ")} (matched: ${taintCheck.matchedFragments.join(", ")})`;
      console.error(`[gateway] [BLOCKED] ${reason}`);
      insertPolicyDecision(db, {
        toolName: name,
        decision: "block",
        reason,
        sourceProvenanceIds: JSON.stringify(taintCheck.matchedProvenanceIds),
      });
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `[taintmcp] Blocked: ${reason}. This call was not sent to the downstream server.`,
          },
        ],
      };
    }

    insertPolicyDecision(db, {
      toolName: name,
      decision: "allow",
      reason: taintCheck.tainted ? "tainted but target tool is not marked sensitive" : "no taint detected",
      sourceProvenanceIds: JSON.stringify(taintCheck.matchedProvenanceIds),
    });

    const result = (await conn.client.callTool({ name, arguments: args })) as CallToolResult;
    const provenanceId = generateProvenanceId();
    const responseText = extractResponseText(result);

    taintStore.push({ provenanceId, serverId: conn.serverId, toolName: name, text: responseText });
    insertProvenanceLog(db, {
      provenanceId,
      serverId: conn.serverId,
      toolName: name,
      direction: "response",
      tainted: 1,
      sourceProvenanceIds: JSON.stringify([]),
      content: responseText,
    });

    return wrapWithProvenance(result, provenanceId, conn.serverId, name);
  });

  // This process is itself spawned over stdio by whatever connects to the
  // gateway, so its own stdin/stdout are reserved for that JSON-RPC
  // stream. All logging above and below goes to stderr instead.
  const serverTransport = new StdioServerTransport();
  await server.connect(serverTransport);
  console.error("[gateway] ready as an MCP server on stdio");

  return {
    close: async () => {
      await server.close();
      for (const conn of connections) {
        await conn.client.close();
      }
      db.close();
    },
  };
}
