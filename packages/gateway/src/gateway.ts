import type { DatabaseSync } from "node:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import type { GatewayConfig, TargetConfig } from "./config.js";
import { classifyTier, checkScopeViolation, decidePolicy, type ShadowStatus } from "./policy.js";
import {
  checkCallProvenance,
  extractResponseText,
  generateProvenanceId,
  wrapWithProvenance,
  type TaintedResponse,
} from "./provenance.js";
import { checkRugPull, type RugPullResult } from "./rugpull.js";
import { scanTool, type ScanFinding } from "./scanner.js";
import { checkToolShadowing, exactlyShadowedNames, fuzzilyShadowedNames, type NamedTool, type ShadowFinding } from "./shadow.js";
import { insertPolicyDecision, insertProvenanceLog, insertRugPullEvent, insertScanFinding, insertShadowFinding, openStore } from "./storage.js";

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
  const inspections: ToolInspection[] = tools.map((tool) => {
    const scanFindings = scanTool(tool);
    const rugPull = checkRugPull(db, serverId, tool);

    for (const finding of scanFindings) {
      insertScanFinding(db, { serverId, toolName: tool.name, check: finding.check, detail: finding.detail });
    }
    if (rugPull.status === "changed" && rugPull.previousHash) {
      insertRugPullEvent(db, { serverId, toolName: tool.name, previousHash: rugPull.previousHash, currentHash: rugPull.currentHash });
    }

    return { tool, scanFindings, rugPull };
  });
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
 * Check #3: tool shadowing detector. Runs once, after every configured
 * server has connected and been inspected by checks #1/#2, comparing
 * every server's tools against every other server's. Unlike the scanner
 * and rug-pull detector (per-server, per-tool), shadowing is inherently a
 * cross-server check — a single tool's schema tells you nothing about
 * whether another server is impersonating it.
 */
export function logShadowReport(findings: ShadowFinding[]): void {
  if (findings.length === 0) {
    console.error("[gateway] tool shadowing check: no collisions across connected servers");
    return;
  }
  for (const f of findings) {
    if (f.severity === "exact") {
      console.error(
        `[gateway] [SHADOW: exact] tool "${f.toolName}" is registered by both "${f.serverId}" and "${f.otherServerId}" — ` +
          `routing is ambiguous and calls to it will be blocked until this is resolved`,
      );
    } else {
      console.error(
        `[gateway] [SHADOW: fuzzy] "${f.serverId}"'s "${f.toolName}" is suspiciously close (edit distance ${f.distance}) to ` +
          `"${f.otherServerId}"'s "${f.otherToolName}" — possible typosquat`,
      );
    }
  }
}

/**
 * Milestone 4 adds check #3 (tool shadowing, above) and replaces
 * milestone 3's hardcoded "block if tainted and destructive" shortcut
 * with the real, configurable policy engine (check #6) — see policy.ts.
 * It combines tool sensitivity tier, taint/provenance status (check #4),
 * permission-scope violations (check #5), and shadow status (check #3)
 * into a final allow / flag / block decision per call.
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
  // reported it. On an exact shadow collision this is inherently
  // ambiguous — the policy engine blocks calls to that name outright
  // (see below), so which connection "wins" here never actually matters.
  const toolOwner = new Map<string, DownstreamConnection>();
  const toolByName = new Map<string, Tool>();
  const namedTools: NamedTool[] = [];
  for (const conn of connections) {
    const { tools } = await conn.client.listTools();
    for (const tool of tools) {
      toolOwner.set(tool.name, conn);
      toolByName.set(tool.name, tool);
      namedTools.push({ serverId: conn.serverId, tool });
    }
  }

  const shadowFindings = checkToolShadowing(namedTools);
  logShadowReport(shadowFindings);
  for (const f of shadowFindings) {
    insertShadowFinding(db, {
      severity: f.severity,
      toolName: f.toolName,
      otherToolName: f.otherToolName,
      serverId: f.serverId,
      otherServerId: f.otherServerId,
      distance: f.distance,
    });
  }
  const exactShadowed = exactlyShadowedNames(shadowFindings);
  const fuzzyShadowed = fuzzilyShadowedNames(shadowFindings);

  function shadowStatusFor(name: string): { status: ShadowStatus; detail?: string } {
    if (exactShadowed.has(name)) {
      const f = shadowFindings.find((s) => s.severity === "exact" && (s.toolName === name || s.otherToolName === name));
      const otherServerId = f && (f.toolName === name ? f.otherServerId : f.serverId);
      return { status: "exact", detail: otherServerId && `also registered by "${otherServerId}"` };
    }
    if (fuzzyShadowed.has(name)) {
      const f = shadowFindings.find((s) => s.severity === "fuzzy" && (s.toolName === name || s.otherToolName === name));
      const otherName = f && (f.toolName === name ? f.otherToolName : f.toolName);
      return { status: "fuzzy", detail: otherName && `closely resembles "${otherName}"` };
    }
    return { status: "none" };
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

    const taintCheck = checkCallProvenance(args, taintStore);
    insertProvenanceLog(db, {
      provenanceId: generateProvenanceId(),
      serverId: toolOwner.get(name)?.serverId ?? "unknown",
      toolName: name,
      direction: "call",
      tainted: taintCheck.tainted ? 1 : 0,
      sourceProvenanceIds: JSON.stringify(taintCheck.matchedProvenanceIds),
      content: JSON.stringify(args ?? {}),
    });

    const targetTool = toolByName.get(name);
    const tier = targetTool ? classifyTier(targetTool, config.policy) : "low";
    const scope = checkScopeViolation(name, args, config.policy);
    const shadow = shadowStatusFor(name);

    const policyResult = decidePolicy(
      {
        toolName: name,
        tier,
        tainted: taintCheck.tainted,
        matchedProvenanceIds: taintCheck.matchedProvenanceIds,
        scopeViolation: scope.violation,
        scopeReason: scope.reason,
        shadowStatus: shadow.status,
        shadowDetail: shadow.detail,
      },
      config.policy,
    );
    const reason = policyResult.reasons.join(" | ");

    insertPolicyDecision(db, {
      toolName: name,
      decision: policyResult.decision,
      reason,
      sourceProvenanceIds: JSON.stringify(taintCheck.matchedProvenanceIds),
    });

    if (policyResult.decision === "block") {
      console.error(`[gateway] [BLOCKED] ${reason}`);
      return {
        isError: true,
        content: [{ type: "text", text: `[taintmcp] Blocked: ${reason}. This call was not sent to the downstream server.` }],
      };
    }

    const conn = toolOwner.get(name);
    if (!conn) {
      throw new Error(`taintmcp gateway: no connected server owns tool "${name}"`);
    }

    if (policyResult.decision === "flag") {
      console.error(`[gateway] [FLAGGED] ${reason}`);
    }

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

    const wrapped = wrapWithProvenance(result, provenanceId, conn.serverId, name);
    if (policyResult.decision === "flag" && Array.isArray(wrapped.content)) {
      return {
        ...wrapped,
        content: [{ type: "text" as const, text: `[taintmcp] FLAGGED FOR REVIEW: ${reason}` }, ...wrapped.content],
      };
    }
    return wrapped;
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
