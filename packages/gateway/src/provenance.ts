import { randomBytes } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Check #4: output tainting + provenance tracking. Every tool response is
// wrapped in explicit untrusted-content markers before being relayed to
// the agent, tagged with a provenance ID. If a later tool call's
// arguments appear to have been influenced by that content, the call is
// linked back to it — the provenance chain.
//
// Tracing "influence" through an LLM's reasoning has no ground truth
// short of the model's own internals, so this uses a pragmatic heuristic
// rather than formal dataflow analysis: a call is considered tainted by a
// prior response if the call's arguments contain a sufficiently
// distinctive fragment (an email address, or a long word/token) that also
// appears in that response's text. This will miss attacks where the
// injected content is heavily paraphrased before it resurfaces in a call,
// and can in principle false-positive on coincidental overlap — a known
// limitation, not a hidden one. It's the "flagship feature" the brief
// itself notes doesn't have a working, general-purpose answer yet.

export interface TaintedResponse {
  provenanceId: string;
  serverId: string;
  toolName: string;
  text: string;
}

export interface TaintCheckResult {
  tainted: boolean;
  matchedProvenanceIds: string[];
  matchedFragments: string[];
}

export function generateProvenanceId(): string {
  return `prov_${randomBytes(6).toString("hex")}`;
}

function extractDistinctiveTokens(text: string): string[] {
  const emails = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [];
  const longWords = text.match(/\b\w{8,}\b/g) ?? [];
  return [...new Set([...emails, ...longWords])];
}

function extractText(content: CallToolResult["content"]): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n");
}

/** Wraps a tool response's text content in explicit untrusted-content markers carrying its provenance ID. */
export function wrapWithProvenance(result: CallToolResult, provenanceId: string, serverId: string, toolName: string): CallToolResult {
  if (!Array.isArray(result.content)) return result;
  return {
    ...result,
    content: result.content.map((block) => {
      if (block.type !== "text") return block;
      return {
        ...block,
        text: `<untrusted-content provenance-id="${provenanceId}" source="${serverId}/${toolName}">\n${block.text}\n</untrusted-content>`,
      };
    }),
  };
}

export function extractResponseText(result: CallToolResult): string {
  return extractText(result.content);
}

/** Checks whether the string-valued fields of a tool call's arguments contain fragments traceable back to previously tainted responses. */
export function checkCallProvenance(args: Record<string, unknown> | undefined, taintStore: TaintedResponse[]): TaintCheckResult {
  const values = Object.values(args ?? {}).filter((v): v is string => typeof v === "string");
  const matchedProvenanceIds: string[] = [];
  const matchedFragments: string[] = [];

  for (const tainted of taintStore) {
    const tokens = extractDistinctiveTokens(tainted.text);
    for (const value of values) {
      const normalizedValue = value.toLowerCase();
      for (const token of tokens) {
        if (normalizedValue.includes(token.toLowerCase())) {
          matchedProvenanceIds.push(tainted.provenanceId);
          matchedFragments.push(token);
        }
      }
    }
  }

  return {
    tainted: matchedProvenanceIds.length > 0,
    matchedProvenanceIds: [...new Set(matchedProvenanceIds)],
    matchedFragments: [...new Set(matchedFragments)],
  };
}
