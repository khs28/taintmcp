import { randomUUID } from "node:crypto";
import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const PORT = Number(process.env.PORT ?? 3200);

const CONDITIONS = ["clear skies", "light rain", "overcast", "scattered clouds", "sunny", "windy"];

// Deterministic, offline "weather" so the fixture never makes a real network
// call and always returns the same result for the same city.
function mockWeather(city: string): { conditions: string; tempC: number } {
  let hash = 0;
  for (const ch of city.toLowerCase()) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return {
    conditions: CONDITIONS[hash % CONDITIONS.length],
    tempC: 5 + (hash % 30),
  };
}

function createServer(): McpServer {
  const server = new McpServer({ name: "benign-weather-server", version: "0.1.0" });

  server.registerTool(
    "get_weather",
    {
      title: "Get Weather",
      description: "Returns the current weather for a given city.",
      inputSchema: { city: z.string().describe("City name, e.g. 'London'") },
    },
    async ({ city }) => {
      const { conditions, tempC } = mockWeather(city);
      return {
        content: [
          {
            type: "text",
            text: `Weather in ${city}: ${conditions}, ${tempC}°C.`,
          },
        ],
      };
    },
  );

  return server;
}

async function main() {
  const app = express();
  app.use(express.json());

  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await server.connect(transport);

  app.all("/mcp", async (req, res) => {
    await transport.handleRequest(req, res, req.body);
  });

  app.listen(PORT, () => {
    console.log(`[benign-server] get_weather MCP server listening on http://localhost:${PORT}/mcp`);
  });
}

main().catch((err) => {
  console.error("[benign-server] fatal error:", err);
  process.exit(1);
});
