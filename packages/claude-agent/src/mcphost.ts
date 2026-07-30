import type Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface ToolCallOutcome {
  text: string;
  isError: boolean;
}

/**
 * What the agent talks to: either every downstream server directly
 * (simulating no gateway at all), or a single taintmcp gateway process
 * (which itself may be proxying several downstream servers). Same
 * interface either way, so the agent loop in agent.ts doesn't need to
 * know or care which topology it's running against.
 */
export interface McpHost {
  listAnthropicTools(): Promise<Anthropic.Tool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolCallOutcome>;
  close(): Promise<void>;
}

function extractOutcome(result: CallToolResult): ToolCallOutcome {
  const text = Array.isArray(result.content)
    ? result.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .filter(Boolean)
        .join("\n")
    : "";
  return { text, isError: result.isError === true };
}

function toAnthropicTool(tool: { name: string; description?: string; inputSchema: unknown }): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description ?? "",
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
  };
}

interface StdioTarget {
  command: string;
  args: string[];
}

/** No gateway involved: connects directly to every target as its own MCP client, exactly as an unprotected agent would. */
export async function connectDirect(targets: StdioTarget[]): Promise<McpHost> {
  const clients = await Promise.all(
    targets.map(async (target) => {
      const client = new Client({ name: "claude-agent", version: "0.1.0" });
      await client.connect(new StdioClientTransport({ command: target.command, args: target.args }));
      return client;
    }),
  );

  const toolOwner = new Map<string, Client>();

  return {
    async listAnthropicTools() {
      const anthropicTools: Anthropic.Tool[] = [];
      for (const client of clients) {
        const { tools } = await client.listTools();
        for (const tool of tools) {
          toolOwner.set(tool.name, client);
          anthropicTools.push(toAnthropicTool(tool));
        }
      }
      return anthropicTools;
    },
    async callTool(name, args) {
      const client = toolOwner.get(name);
      if (!client) throw new Error(`no connected server owns tool "${name}"`);
      const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
      return extractOutcome(result);
    },
    async close() {
      for (const client of clients) await client.close();
    },
  };
}

/** Everything goes through the taintmcp gateway as a single MCP server. */
export async function connectViaGateway(target: StdioTarget): Promise<McpHost> {
  const client = new Client({ name: "claude-agent", version: "0.1.0" });
  await client.connect(new StdioClientTransport({ command: target.command, args: target.args }));

  return {
    async listAnthropicTools() {
      const { tools } = await client.listTools();
      return tools.map(toAnthropicTool);
    },
    async callTool(name, args) {
      const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
      return extractOutcome(result);
    },
    async close() {
      await client.close();
    },
  };
}
