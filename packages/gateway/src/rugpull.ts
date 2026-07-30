import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getSnapshot, upsertSnapshot } from "./storage.js";

export interface RugPullResult {
  status: "new" | "unchanged" | "changed";
  previousHash?: string;
  currentHash: string;
}

// Sorts object keys recursively so semantically-identical schemas hash the
// same way regardless of property order.
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, val]) => [key, canonicalize(val)]),
    );
  }
  return value;
}

export function hashTool(tool: Tool): string {
  const canonical = canonicalize({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  });
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

// Check #2: rug-pull detector. Hashes a tool's full schema/description on
// first connection and stores it; on every later connection, diffs the
// current hash against what was stored to catch a previously-trusted tool
// silently changing.
export function checkRugPull(db: DatabaseSync, serverId: string, tool: Tool): RugPullResult {
  const currentHash = hashTool(tool);
  const existing = getSnapshot(db, serverId, tool.name);

  upsertSnapshot(db, {
    serverId,
    toolName: tool.name,
    schemaHash: currentHash,
    schemaJson: JSON.stringify(tool),
  });

  if (!existing) {
    return { status: "new", currentHash };
  }
  if (existing.schemaHash === currentHash) {
    return { status: "unchanged", currentHash };
  }
  return { status: "changed", previousHash: existing.schemaHash, currentHash };
}
