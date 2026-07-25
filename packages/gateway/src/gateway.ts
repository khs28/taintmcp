import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import express from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
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
  const downstreamTransport = new StreamableHTTPClientTransport(new URL(config.target.url));
  await downstream.connect(downstreamTransport);
  console.log(`[gateway] connected as client to downstream MCP server at ${config.target.url}`);

  const server = new Server({ name: "taintmcp-gateway", version: "0.1.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return downstream.listTools();
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return downstream.callTool(request.params);
  });

  const serverTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await server.connect(serverTransport);

  const app = express();
  app.use(express.json());
  app.all("/mcp", async (req, res) => {
    await serverTransport.handleRequest(req, res, req.body);
  });

  const httpServer = await new Promise<HttpServer>((resolve) => {
    const s = app.listen(config.listenPort, () => resolve(s));
  });
  console.log(`[gateway] listening as an MCP server for agents on http://localhost:${config.listenPort}/mcp`);

  return {
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
      await server.close();
      await downstream.close();
    },
  };
}
