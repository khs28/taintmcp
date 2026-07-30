import Anthropic from "@anthropic-ai/sdk";
import type { McpHost } from "./mcphost.js";

export type AgentEvent =
  | { type: "user"; text: string }
  | { type: "assistant"; text: string; toolCalls: { id: string; name: string; input: unknown }[] }
  | { type: "tool-result"; name: string; text: string; isError: boolean }
  | { type: "max-turns-reached" };

export interface RunAgentOptions {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
  host: McpHost;
  maxTurns?: number;
  onEvent?: (event: AgentEvent) => void;
}

export interface RunAgentResult {
  finalText: string;
  toolCalls: { name: string; input: unknown }[];
  toolResults: { name: string; text: string; isError: boolean }[];
}

/**
 * A minimal agentic tool-use loop against the real Anthropic API. No
 * framework, no hidden magic — just what's needed to prove attacks
 * succeed with the gateway off and fail with it on: send a message,
 * execute whatever tools Claude asks for via the given MCP host, feed the
 * results back, repeat until it stops asking for tools.
 */
export async function runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
  const { apiKey, model, systemPrompt, userMessage, host, maxTurns = 6, onEvent } = options;
  const anthropic = new Anthropic({ apiKey });
  const tools = await host.listAnthropicTools();

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage }];
  const toolCalls: { name: string; input: unknown }[] = [];
  const toolResults: { name: string; text: string; isError: boolean }[] = [];
  onEvent?.({ type: "user", text: userMessage });

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      tools,
      messages,
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    const toolUses = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");

    onEvent?.({
      type: "assistant",
      text,
      toolCalls: toolUses.map((t) => ({ id: t.id, name: t.name, input: t.input })),
    });

    if (toolUses.length === 0) {
      return { finalText: text, toolCalls, toolResults };
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      toolCalls.push({ name: toolUse.name, input: toolUse.input });
      const outcome = await host.callTool(toolUse.name, toolUse.input as Record<string, unknown>);
      toolResults.push({ name: toolUse.name, text: outcome.text, isError: outcome.isError });
      onEvent?.({ type: "tool-result", name: toolUse.name, text: outcome.text, isError: outcome.isError });
      toolResultBlocks.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: outcome.text,
        is_error: outcome.isError,
      });
    }
    messages.push({ role: "user", content: toolResultBlocks });
  }

  onEvent?.({ type: "max-turns-reached" });
  return { finalText: "(max turns reached without a final answer)", toolCalls, toolResults };
}
