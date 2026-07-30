import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { GatewayConfig } from "./config.js";

export interface RunningGateway {
  close: () => Promise<void>;
}

/**
 * Milestone 1: pure protocol plumbing. The gateway presents itself as an MCP
 * server to whatever connects to it, and as an MCP client to a single
 * downstream server, forwarding tools/list and tools/call verbatim in both
 * directions. No inspection, tagging, or blocking logic yet.
 */
export async function startGateway(config: GatewayConfig): Promise<RunningGateway> {
  const downstream = new Client({ name: "taintmcp-gateway", version: "0.1.0" });
  const downstreamTransport = new StdioClientTransport({
    command: config.target.command,
    args: config.target.args,
  });
  await downstream.connect(downstreamTransport);
  console.error(
    `[gateway] connected as client to downstream MCP server (${config.target.command} ${config.target.args.join(" ")})`,
  );

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
    },
  };
}
