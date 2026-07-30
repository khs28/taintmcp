import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export interface ScanFinding {
  check: "imperative-language" | "hidden-unicode" | "undocumented-parameter";
  detail: string;
}

// Check #1: schema/description scanner. Looks for patterns published
// research associates with tool poisoning: imperative command language
// aimed at the model rather than describing the tool to a human, invisible
// Unicode hiding extra instructions, and parameters the schema accepts but
// the description never explains.

const IMPERATIVE_PATTERNS: RegExp[] = [
  /\bignore (?:all|any|previous|prior)\s+instructions?\b/i,
  /\bdisregard (?:all|any|previous|prior)\s+instructions?\b/i,
  /\balways (?:call|run|use|invoke)\b/i,
  /\bsystem\s*:/i,
  /\byou must\b/i,
  /\bwithout telling the user\b/i,
  /\bdo not (?:tell|mention|inform|disclose)\b/i,
  /\bforward\b[^.]{0,40}\bto\b/i,
  /\boverride\b[^.]{0,20}\b(?:instructions|rules|policy)\b/i,
];

// Zero-width spaces/joiners (U+200B-200F), bidi control characters
// (U+202A-202E), other invisible format characters (U+2060-206F), and the
// BOM (U+FEFF) — none have a legitimate reason to appear in a tool
// description meant for a human to read.
const HIDDEN_UNICODE_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/u;

function findImperativeLanguage(text: string): ScanFinding[] {
  const findings: ScanFinding[] = [];
  for (const pattern of IMPERATIVE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      findings.push({
        check: "imperative-language",
        detail: `description contains imperative/system-style language: "${match[0]}"`,
      });
    }
  }
  return findings;
}

function findHiddenUnicode(text: string): ScanFinding[] {
  const matches = text.match(new RegExp(HIDDEN_UNICODE_RE, "gu"));
  if (!matches) return [];
  return [
    {
      check: "hidden-unicode",
      detail: `description contains ${matches.length} invisible/zero-width Unicode character(s)`,
    },
  ];
}

function findUndocumentedParameters(tool: Tool): ScanFinding[] {
  const description = (tool.description ?? "").toLowerCase();
  const properties = tool.inputSchema?.properties ?? {};
  const findings: ScanFinding[] = [];
  for (const paramName of Object.keys(properties)) {
    const spaced = paramName.toLowerCase().replace(/_/g, " ");
    const mentioned = description.includes(paramName.toLowerCase()) || description.includes(spaced);
    if (!mentioned) {
      findings.push({
        check: "undocumented-parameter",
        detail: `parameter "${paramName}" is accepted by the input schema but never mentioned in the tool's description`,
      });
    }
  }
  return findings;
}

export function scanTool(tool: Tool): ScanFinding[] {
  const text = `${tool.name} ${tool.description ?? ""}`;
  return [...findImperativeLanguage(text), ...findHiddenUnicode(text), ...findUndocumentedParameters(tool)];
}
