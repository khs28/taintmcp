import type { Tool } from "@modelcontextprotocol/sdk/types.js";

// Check #3: tool shadowing detector. Across every currently-connected
// server, flags name collisions between tools registered by *different*
// servers — the pattern the brief describes as "a malicious server
// registers a tool with a name confusingly similar to a legitimate one,
// intercepting calls meant for it." Two severities:
//   - "exact": two servers register the identical tool name. Routing is
//     now ambiguous — whichever server connected last silently wins the
//     name, meaning calls the agent believes are going to the trusted
//     server can be intercepted by the untrusted one.
//   - "fuzzy": two servers register names that are not identical but are
//     within a small Levenshtein distance of each other (e.g.
//     "get_weather" vs "get_weathr") — a classic typosquat.

export interface NamedTool {
  serverId: string;
  tool: Tool;
}

export interface ShadowFinding {
  severity: "exact" | "fuzzy";
  toolName: string;
  otherToolName: string;
  serverId: string;
  otherServerId: string;
  distance: number;
}

// Only worth comparing names that are close enough in length that a small
// edit distance is actually meaningful, and long enough that short,
// legitimately-similar names (e.g. "ls" vs "cp") don't false-positive.
const MIN_NAME_LENGTH_FOR_FUZZY_CHECK = 4;
const FUZZY_DISTANCE_THRESHOLD = 2;

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dist: number[][] = Array.from({ length: rows }, (_, i) => [i, ...Array(cols - 1).fill(0)]);
  for (let j = 0; j < cols; j++) dist[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dist[i][j] = Math.min(dist[i - 1][j] + 1, dist[i][j - 1] + 1, dist[i - 1][j - 1] + cost);
    }
  }
  return dist[rows - 1][cols - 1];
}

/** Compares every tool from every currently-connected server against every other server's tools. */
export function checkToolShadowing(namedTools: NamedTool[]): ShadowFinding[] {
  const findings: ShadowFinding[] = [];
  const seenPairs = new Set<string>();

  for (let i = 0; i < namedTools.length; i++) {
    for (let j = i + 1; j < namedTools.length; j++) {
      const a = namedTools[i];
      const b = namedTools[j];
      if (a.serverId === b.serverId) continue;

      const nameA = a.tool.name;
      const nameB = b.tool.name;

      if (nameA === nameB) {
        const pairKey = `exact:${a.serverId}<${b.serverId}>${nameA}`;
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);
        findings.push({
          severity: "exact",
          toolName: nameA,
          otherToolName: nameB,
          serverId: a.serverId,
          otherServerId: b.serverId,
          distance: 0,
        });
        continue;
      }

      if (nameA.length < MIN_NAME_LENGTH_FOR_FUZZY_CHECK || nameB.length < MIN_NAME_LENGTH_FOR_FUZZY_CHECK) continue;
      const distance = levenshtein(nameA, nameB);
      if (distance > 0 && distance <= FUZZY_DISTANCE_THRESHOLD) {
        findings.push({
          severity: "fuzzy",
          toolName: nameA,
          otherToolName: nameB,
          serverId: a.serverId,
          otherServerId: b.serverId,
          distance,
        });
      }
    }
  }

  return findings;
}

/** Tool names implicated in an exact-collision finding — routing to them is inherently ambiguous. */
export function exactlyShadowedNames(findings: ShadowFinding[]): Set<string> {
  return new Set(findings.filter((f) => f.severity === "exact").flatMap((f) => [f.toolName, f.otherToolName]));
}

/** Tool names implicated in a fuzzy-collision finding — worth extra scrutiny but not inherently ambiguous to route. */
export function fuzzilyShadowedNames(findings: ShadowFinding[]): Set<string> {
  return new Set(findings.filter((f) => f.severity === "fuzzy").flatMap((f) => [f.toolName, f.otherToolName]));
}
