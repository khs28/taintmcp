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
  `);
  return db;
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
