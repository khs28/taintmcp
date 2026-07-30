#!/usr/bin/env node
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

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

async function main() {
  // NOTE: this process is spawned over stdio by whatever connects to it (the
  // gateway, in milestone 1). stdout/stdin are reserved for the JSON-RPC
  // stream, so all diagnostic logging must go to stderr.
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[benign-server] get_weather MCP server ready on stdio");
}

main().catch((err) => {
  console.error("[benign-server] fatal error:", err);
  process.exit(1);
});
