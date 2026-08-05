#!/usr/bin/env node
// Milestone 5: a static HTML dashboard reading a taintmcp SQLite log —
// no server, no framework, just a self-contained file you open in a
// browser. Makes provenance chains, rug-pull diffs, shadow findings, and
// policy decisions visually demoable instead of scrollback in a
// terminal.
//
// Usage: node scripts/dashboard.mjs [dbPath] [outFile]
//   dbPath  defaults to taintmcp.m4.db (richest fixture: exercises every
//           check). Run `npm run demo:m4` first to populate it.
//   outFile defaults to dashboard.html in the repo root.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  openStore,
  listPolicyDecisions,
  listScanFindings,
  listRugPullEvents,
  listShadowFindings,
  listProvenanceLog,
  listToolSnapshots,
} from "taintmcp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = path.resolve(ROOT, process.argv[2] ?? "taintmcp.m4.db");
const outFile = path.resolve(ROOT, process.argv[3] ?? "dashboard.html");

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function shortHash(hash) {
  return esc(hash).slice(0, 12) + "…";
}

function fmtTime(iso) {
  return esc(iso).replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

function badge(kind, label) {
  const icons = { good: "✓", warning: "▲", critical: "✕" };
  return `<span class="badge badge-${kind}">${icons[kind]} ${esc(label)}</span>`;
}

function decisionBadge(decision) {
  if (decision === "allow") return badge("good", "allow");
  if (decision === "flag") return badge("warning", "flag");
  return badge("critical", "block");
}

function statTile(value, label, kind) {
  return `<div class="stat-tile"><div class="stat-value stat-${kind ?? "neutral"}">${value}</div><div class="stat-label">${esc(label)}</div></div>`;
}

function table(headers, rows, emptyMessage) {
  if (rows.length === 0) {
    return `<p class="empty-state">${esc(emptyMessage)}</p>`;
  }
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join("");
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("\n");
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function chips(jsonArray) {
  let ids;
  try {
    ids = JSON.parse(jsonArray);
  } catch {
    ids = [];
  }
  if (!Array.isArray(ids) || ids.length === 0) return '<span class="muted">—</span>';
  return ids.map((id) => `<span class="chip">${esc(id)}</span>`).join(" ");
}

function main() {
  const db = openStore(dbPath);

  const policyDecisions = listPolicyDecisions(db);
  const scanFindings = listScanFindings(db);
  const rugPullEvents = listRugPullEvents(db);
  const shadowFindings = listShadowFindings(db);
  const provenanceLog = listProvenanceLog(db);
  const toolSnapshots = listToolSnapshots(db);

  db.close();

  const totalCalls = provenanceLog.filter((p) => p.direction === "call").length;
  const blocked = policyDecisions.filter((p) => p.decision === "block").length;
  const flagged = policyDecisions.filter((p) => p.decision === "flag").length;
  const poisonedTools = new Set(scanFindings.map((f) => `${f.serverId}/${f.toolName}`)).size;

  const statsHtml = [
    statTile(totalCalls, "Tool calls logged", "neutral"),
    statTile(blocked, "Blocked", blocked > 0 ? "critical" : "neutral"),
    statTile(flagged, "Flagged for review", flagged > 0 ? "warning" : "neutral"),
    statTile(rugPullEvents.length, "Rug-pulls detected", rugPullEvents.length > 0 ? "critical" : "neutral"),
    statTile(shadowFindings.length, "Shadow collisions", shadowFindings.length > 0 ? "critical" : "neutral"),
    statTile(poisonedTools, "Tools flagged by scanner", poisonedTools > 0 ? "warning" : "neutral"),
  ].join("\n");

  const policyRows = policyDecisions.map((d) => [
    `<span class="mono">${fmtTime(d.createdAt)}</span>`,
    `<span class="mono">${esc(d.toolName)}</span>`,
    decisionBadge(d.decision),
    `<span class="reason">${esc(d.reason)}</span>`,
  ]);

  const provenanceRows = provenanceLog.map((p) => [
    `<span class="mono">${fmtTime(p.createdAt)}</span>`,
    esc(p.direction),
    `<span class="mono">${esc(p.serverId)}</span>`,
    `<span class="mono">${esc(p.toolName)}</span>`,
    p.tainted ? badge("warning", "tainted") : `<span class="muted">clean</span>`,
    chips(p.sourceProvenanceIds),
    `<span class="excerpt">${esc(p.contentExcerpt).slice(0, 140)}${p.contentExcerpt.length > 140 ? "…" : ""}</span>`,
  ]);

  const shadowRows = shadowFindings.map((f) => [
    f.severity === "exact" ? badge("critical", "exact") : badge("warning", "fuzzy"),
    `<span class="mono">${esc(f.toolName)}</span> <span class="muted">(${esc(f.serverId)})</span>`,
    `<span class="mono">${esc(f.otherToolName)}</span> <span class="muted">(${esc(f.otherServerId)})</span>`,
    f.distance,
    `<span class="mono">${fmtTime(f.createdAt)}</span>`,
  ]);

  const rugPullRows = rugPullEvents.map((r) => [
    `<span class="mono">${esc(r.serverId)}</span>`,
    `<span class="mono">${esc(r.toolName)}</span>`,
    `<span class="mono">${shortHash(r.previousHash)}</span>`,
    `<span class="mono">${shortHash(r.currentHash)}</span>`,
    `<span class="mono">${fmtTime(r.detectedAt)}</span>`,
  ]);

  const scanRows = scanFindings.map((f) => [
    `<span class="mono">${esc(f.serverId)}</span>`,
    `<span class="mono">${esc(f.toolName)}</span>`,
    `<span class="chip">${esc(f.check)}</span>`,
    `<span class="reason">${esc(f.detail)}</span>`,
  ]);

  const snapshotRows = toolSnapshots.map((s) => [
    `<span class="mono">${esc(s.serverId)}</span>`,
    `<span class="mono">${esc(s.toolName)}</span>`,
    `<span class="mono">${shortHash(s.schemaHash)}</span>`,
    `<span class="mono">${fmtTime(s.firstSeenAt)}</span>`,
    `<span class="mono">${fmtTime(s.lastSeenAt)}</span>`,
  ]);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>taintmcp dashboard</title>
<style>
  :root {
    color-scheme: light;
    --surface-1: #fcfcfb;
    --page: #f9f9f7;
    --text-primary: #0b0b0b;
    --text-secondary: #52514e;
    --text-muted: #898781;
    --gridline: #e1e0d9;
    --border: rgba(11,11,11,0.10);
    --good: #0ca30c;
    --warning: #fab219;
    --critical: #d03b3b;
    --chip-bg: #f0efec;
  }
  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) {
      color-scheme: dark;
      --surface-1: #1a1a19;
      --page: #0d0d0d;
      --text-primary: #ffffff;
      --text-secondary: #c3c2b7;
      --text-muted: #898781;
      --gridline: #2c2c2a;
      --border: rgba(255,255,255,0.10);
      --good: #0ca30c;
      --warning: #fab219;
      --critical: #e66767;
      --chip-bg: #262623;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --surface-1: #1a1a19;
    --page: #0d0d0d;
    --text-primary: #ffffff;
    --text-secondary: #c3c2b7;
    --text-muted: #898781;
    --gridline: #2c2c2a;
    --border: rgba(255,255,255,0.10);
    --good: #0ca30c;
    --warning: #fab219;
    --critical: #e66767;
    --chip-bg: #262623;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--page);
    color: var(--text-primary);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    padding: 32px 16px 64px;
  }
  .wrap { max-width: 1100px; margin: 0 auto; }
  header { margin-bottom: 28px; }
  h1 { font-size: 1.5rem; margin: 0 0 4px; }
  .subtitle { color: var(--text-secondary); font-size: 0.9rem; }
  .mono { font-variant-numeric: tabular-nums; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85rem; }
  section { background: var(--surface-1); border: 1px solid var(--border); border-radius: 12px; padding: 20px 20px 8px; margin-bottom: 20px; }
  section h2 { font-size: 1.05rem; margin: 0 0 4px; }
  section .desc { color: var(--text-secondary); font-size: 0.85rem; margin: 0 0 16px; }
  .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .stat-tile { background: var(--surface-1); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
  .stat-value { font-size: 2rem; font-weight: 600; line-height: 1.1; }
  .stat-neutral { color: var(--text-primary); }
  .stat-warning { color: var(--warning); }
  .stat-critical { color: var(--critical); }
  .stat-label { color: var(--text-secondary); font-size: 0.8rem; margin-top: 4px; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th { text-align: left; color: var(--text-muted); font-weight: 500; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.03em; padding: 8px 10px; border-bottom: 1px solid var(--gridline); white-space: nowrap; }
  td { padding: 8px 10px; border-bottom: 1px solid var(--gridline); vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  .badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; font-weight: 600; white-space: nowrap; }
  .badge-good { color: var(--good); background: color-mix(in srgb, var(--good) 14%, transparent); }
  .badge-warning { color: var(--warning); background: color-mix(in srgb, var(--warning) 18%, transparent); }
  .badge-critical { color: var(--critical); background: color-mix(in srgb, var(--critical) 14%, transparent); }
  .chip { display: inline-block; background: var(--chip-bg); color: var(--text-secondary); border-radius: 6px; padding: 1px 6px; font-size: 0.75rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .muted { color: var(--text-muted); }
  .reason, .excerpt { color: var(--text-secondary); }
  .empty-state { color: var(--text-muted); font-size: 0.85rem; padding-bottom: 16px; }
  footer { color: var(--text-muted); font-size: 0.8rem; margin-top: 8px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>taintmcp dashboard</h1>
    <div class="subtitle">Source: <span class="mono">${esc(path.relative(ROOT, dbPath))}</span> · Generated ${esc(new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC"))}</div>
  </header>

  <div class="stats-row">
    ${statsHtml}
  </div>

  <section>
    <h2>Policy decisions</h2>
    <p class="desc">Check #6 — every <code>tools/call</code> the gateway has seen, and what the policy engine decided (most recent first).</p>
    ${table(["Time", "Tool", "Decision", "Reason"], policyRows, "No policy decisions logged yet — run a demo (e.g. npm run demo:m4) against this database first.")}
  </section>

  <section>
    <h2>Provenance log</h2>
    <p class="desc">Check #4 — every tool response (tainted on arrival) and every call, with the provenance IDs a tainted call traced back to. Chronological, oldest first.</p>
    ${table(["Time", "Direction", "Server", "Tool", "Taint", "Traced from", "Content"], provenanceRows, "No provenance log entries yet.")}
  </section>

  <section>
    <h2>Tool shadowing findings</h2>
    <p class="desc">Check #3 — name collisions across connected servers. Exact collisions mean routing is ambiguous; fuzzy ones are near-miss typosquats.</p>
    ${table(["Severity", "Tool", "Collides with", "Edit distance", "Detected"], shadowRows, "No shadowing collisions detected across the currently connected servers.")}
  </section>

  <section>
    <h2>Rug-pull events</h2>
    <p class="desc">Check #2 — a previously-trusted tool's schema/description changed since the last connection.</p>
    ${table(["Server", "Tool", "Previous hash", "New hash", "Detected"], rugPullRows, "No rug-pulls detected — every tool's schema has matched its stored baseline on every connection so far.")}
  </section>

  <section>
    <h2>Schema scan findings</h2>
    <p class="desc">Check #1 — tool poisoning patterns caught in a tool's name/description/schema at connection time.</p>
    ${table(["Server", "Tool", "Check", "Detail"], scanRows, "No poisoned tool schemas detected.")}
  </section>

  <section>
    <h2>Tool schema snapshots</h2>
    <p class="desc">Current baseline hash on file for every tool ever seen — what future connections are diffed against.</p>
    ${table(["Server", "Tool", "Hash", "First seen", "Last seen"], snapshotRows, "No tool snapshots recorded yet.")}
  </section>

  <footer>Regenerate with <span class="mono">npm run dashboard</span> after running any demo script.</footer>
</div>
</body>
</html>
`;

  writeFileSync(outFile, html);
  console.log(`[dashboard] wrote ${path.relative(ROOT, outFile)} from ${path.relative(ROOT, dbPath)}`);
  console.log(
    `[dashboard] ${totalCalls} call(s), ${blocked} blocked, ${flagged} flagged, ${rugPullEvents.length} rug-pull event(s), ` +
      `${shadowFindings.length} shadow finding(s), ${scanFindings.length} scan finding(s)`,
  );
}

main();
