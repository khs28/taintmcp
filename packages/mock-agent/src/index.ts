import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:3100/mcp";
const CITY = process.env.DEMO_CITY ?? "London";

/**
 * Stands in for a real AI agent for Milestone 1: no LLM is involved. It
 * connects to the gateway exactly as an agent would, lists the tools the
 * gateway exposes, and calls one of them — proving the full round trip
 * (agent -> gateway -> downstream server -> gateway -> agent) works.
 */
async function main() {
  const client = new Client({ name: "mock-agent", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(GATEWAY_URL));
  await client.connect(transport);
  console.log(`[mock-agent] connected to gateway at ${GATEWAY_URL}`);

  const { tools } = await client.listTools();
  console.log(`[mock-agent] tools exposed by gateway: ${tools.map((t) => t.name).join(", ") || "(none)"}`);

  const weatherTool = tools.find((t) => t.name === "get_weather");
  if (!weatherTool) {
    throw new Error("get_weather tool was not exposed through the gateway");
  }

  const result = await client.callTool({ name: "get_weather", arguments: { city: CITY } });
  const text = Array.isArray(result.content)
    ? result.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("")
    : "";
  console.log(`[mock-agent] get_weather(${CITY}) -> ${text}`);

  if (!text.includes(CITY)) {
    throw new Error(`unexpected tool response, expected it to mention "${CITY}": ${JSON.stringify(result)}`);
  }

  await client.close();
  console.log("[mock-agent] round trip OK");
}

main().catch((err) => {
  console.error("[mock-agent] FAILED:", err);
  process.exit(1);
});
