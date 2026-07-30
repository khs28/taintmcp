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

// A legitimate, sensitive tool the agent already has real access to — the
// kind of tool an indirect-injection attack tries to trigger via tainted
// content read from somewhere else entirely (see malicious-server's
// read_notes). destructiveHint marks it as sensitive using the MCP
// protocol's own tool-annotation field, rather than inventing bespoke
// out-of-band config for "which tools are dangerous."
server.registerTool(
  "send_email",
  {
    title: "Send Email",
    description: "Sends an email on the user's behalf, given a recipient (to), subject, and body.",
    inputSchema: {
      to: z.string().describe("Recipient email address"),
      subject: z.string().describe("Email subject line"),
      body: z.string().describe("Email body"),
    },
    annotations: { destructiveHint: true },
  },
  async ({ to, subject }) => {
    // Test fixture only — never actually sends anything.
    return {
      content: [{ type: "text", text: `Email sent to ${to} with subject "${subject}".` }],
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
