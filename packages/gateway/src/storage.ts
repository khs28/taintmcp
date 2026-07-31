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
  decision: "allow" | "flag" | "block";
  reason: string;
  sourceProvenanceIds: string; // JSON array
  createdAt: string;
}

export interface ScanFindingEntry {
  serverId: string;
  toolName: string;
  check: string;
  detail: string;
  createdAt: string;
}

export interface RugPullEventEntry {
  serverId: string;
  toolName: string;
  previousHash: string;
  currentHash: string;
  detectedAt: string;
}

export interface ShadowFindingEntry {
  severity: "exact" | "fuzzy";
  toolName: string;
  otherToolName: string;
  serverId: string;
  otherServerId: string;
  distance: number;
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

    -- check #1 findings, persisted so the dashboard (milestone 5) can show
    -- them without re-running the scanner; ephemeral console logging alone
    -- isn't enough to make this visually demoable after the fact.
    CREATE TABLE IF NOT EXISTS scan_findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      check_name TEXT NOT NULL,
      detail TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- check #2: every time a tool's hash changes from what was last
    -- trusted, not just the current hash (tool_schema_snapshots only ever
    -- holds the latest one) — this is what lets the dashboard show an
    -- actual rug-pull diff instead of just current state.
    CREATE TABLE IF NOT EXISTS rugpull_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      previous_hash TEXT NOT NULL,
      current_hash TEXT NOT NULL,
      detected_at TEXT NOT NULL
    );

    -- check #3 findings, persisted for the same reason as scan_findings.
    CREATE TABLE IF NOT EXISTS shadow_findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      severity TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      other_tool_name TEXT NOT NULL,
      server_id TEXT NOT NULL,
      other_server_id TEXT NOT NULL,
      distance INTEGER NOT NULL,
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

export function insertScanFinding(db: DatabaseSync, entry: Omit<ScanFindingEntry, "createdAt">): void {
  db.prepare(
    `INSERT INTO scan_findings (server_id, tool_name, check_name, detail, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(entry.serverId, entry.toolName, entry.check, entry.detail, new Date().toISOString());
}

export function insertRugPullEvent(db: DatabaseSync, entry: Omit<RugPullEventEntry, "detectedAt">): void {
  db.prepare(
    `INSERT INTO rugpull_events (server_id, tool_name, previous_hash, current_hash, detected_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(entry.serverId, entry.toolName, entry.previousHash, entry.currentHash, new Date().toISOString());
}

export function insertShadowFinding(db: DatabaseSync, entry: Omit<ShadowFindingEntry, "createdAt">): void {
  db.prepare(
    `INSERT INTO shadow_findings (severity, tool_name, other_tool_name, server_id, other_server_id, distance, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(entry.severity, entry.toolName, entry.otherToolName, entry.serverId, entry.otherServerId, entry.distance, new Date().toISOString());
}

export function listPolicyDecisions(db: DatabaseSync): PolicyDecisionEntry[] {
  return db
    .prepare(
      `SELECT tool_name AS toolName, decision, reason, source_provenance_ids AS sourceProvenanceIds, created_at AS createdAt
       FROM policy_decisions ORDER BY id DESC`,
    )
    .all() as unknown as PolicyDecisionEntry[];
}

export function listScanFindings(db: DatabaseSync): ScanFindingEntry[] {
  return db
    .prepare(
      `SELECT server_id AS serverId, tool_name AS toolName, check_name AS "check", detail, created_at AS createdAt
       FROM scan_findings ORDER BY id DESC`,
    )
    .all() as unknown as ScanFindingEntry[];
}

export function listRugPullEvents(db: DatabaseSync): RugPullEventEntry[] {
  return db
    .prepare(
      `SELECT server_id AS serverId, tool_name AS toolName, previous_hash AS previousHash,
              current_hash AS currentHash, detected_at AS detectedAt
       FROM rugpull_events ORDER BY id DESC`,
    )
    .all() as unknown as RugPullEventEntry[];
}

export function listShadowFindings(db: DatabaseSync): ShadowFindingEntry[] {
  return db
    .prepare(
      `SELECT severity, tool_name AS toolName, other_tool_name AS otherToolName, server_id AS serverId,
              other_server_id AS otherServerId, distance, created_at AS createdAt
       FROM shadow_findings ORDER BY id DESC`,
    )
    .all() as unknown as ShadowFindingEntry[];
}

export function listProvenanceLog(db: DatabaseSync): ProvenanceLogEntry[] {
  return db
    .prepare(
      `SELECT provenance_id AS provenanceId, server_id AS serverId, tool_name AS toolName, direction,
              tainted, source_provenance_ids AS sourceProvenanceIds, content_excerpt AS contentExcerpt,
              created_at AS createdAt
       FROM provenance_log ORDER BY id ASC`,
    )
    .all() as unknown as ProvenanceLogEntry[];
}

export function listToolSnapshots(db: DatabaseSync): ToolSnapshot[] {
  return db
    .prepare(
      `SELECT server_id AS serverId, tool_name AS toolName, schema_hash AS schemaHash,
              schema_json AS schemaJson, first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt
       FROM tool_schema_snapshots ORDER BY server_id, tool_name`,
    )
    .all() as unknown as ToolSnapshot[];
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
