import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
// node:sqlite is experimental as of Node 22 but ships in the runtime
// itself, so it needs nothing from npm — a deliberate choice given how
// often milestone 1 got stuck on registry access. See rugpull.ts for why
// this table exists.
import { DatabaseSync } from "node:sqlite";

export interface ToolSnapshot {
  serverId: string;
  toolName: string;
  schemaHash: string;
  schemaJson: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface ProvenanceLogEntry {
  provenanceId: string;
  serverId: string;
  toolName: string;
  direction: "response" | "call";
  tainted: number; // 0 or 1 — node:sqlite has no native boolean column type
  sourceProvenanceIds: string; // JSON array, populated for direction = "call"
  contentExcerpt: string;
  createdAt: string;
}

export interface PolicyDecisionEntry {
  toolName: string;
  decision: "allow" | "block";
  reason: string;
  sourceProvenanceIds: string; // JSON array
  createdAt: string;
}

export function openStore(dbPath: string): DatabaseSync {
  const resolved = resolve(dbPath);
  mkdirSync(dirname(resolved), { recursive: true });
  const db = new DatabaseSync(resolved);
  db.exec(`
    CREATE TABLE IF NOT EXISTS tool_schema_snapshots (
      server_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      schema_hash TEXT NOT NULL,
      schema_json TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY (server_id, tool_name)
    );

    CREATE TABLE IF NOT EXISTS provenance_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provenance_id TEXT NOT NULL,
      server_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      direction TEXT NOT NULL,
      tainted INTEGER NOT NULL,
      source_provenance_ids TEXT NOT NULL,
      content_excerpt TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS policy_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_name TEXT NOT NULL,
      decision TEXT NOT NULL,
      reason TEXT NOT NULL,
      source_provenance_ids TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

const EXCERPT_MAX_LENGTH = 500;

export function insertProvenanceLog(
  db: DatabaseSync,
  entry: Omit<ProvenanceLogEntry, "createdAt" | "contentExcerpt"> & { content: string },
): void {
  db.prepare(
    `INSERT INTO provenance_log (provenance_id, server_id, tool_name, direction, tainted, source_provenance_ids, content_excerpt, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.provenanceId,
    entry.serverId,
    entry.toolName,
    entry.direction,
    entry.tainted,
    entry.sourceProvenanceIds,
    entry.content.slice(0, EXCERPT_MAX_LENGTH),
    new Date().toISOString(),
  );
}

export function insertPolicyDecision(db: DatabaseSync, entry: Omit<PolicyDecisionEntry, "createdAt">): void {
  db.prepare(
    `INSERT INTO policy_decisions (tool_name, decision, reason, source_provenance_ids, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(entry.toolName, entry.decision, entry.reason, entry.sourceProvenanceIds, new Date().toISOString());
}

export function getSnapshot(db: DatabaseSync, serverId: string, toolName: string): ToolSnapshot | undefined {
  const row = db
    .prepare(
      `SELECT server_id AS serverId, tool_name AS toolName, schema_hash AS schemaHash,
              schema_json AS schemaJson, first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt
       FROM tool_schema_snapshots WHERE server_id = ? AND tool_name = ?`,
    )
    .get(serverId, toolName) as ToolSnapshot | undefined;
  return row;
}

export function upsertSnapshot(
  db: DatabaseSync,
  snapshot: { serverId: string; toolName: string; schemaHash: string; schemaJson: string },
): void {
  const now = new Date().toISOString();
  const existing = getSnapshot(db, snapshot.serverId, snapshot.toolName);
  if (existing) {
    db.prepare(
      `UPDATE tool_schema_snapshots SET schema_hash = ?, schema_json = ?, last_seen_at = ?
       WHERE server_id = ? AND tool_name = ?`,
    ).run(snapshot.schemaHash, snapshot.schemaJson, now, snapshot.serverId, snapshot.toolName);
  } else {
    db.prepare(
      `INSERT INTO tool_schema_snapshots (server_id, tool_name, schema_hash, schema_json, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(snapshot.serverId, snapshot.toolName, snapshot.schemaHash, snapshot.schemaJson, now, now);
  }
}
