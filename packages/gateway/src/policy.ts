import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { PolicyConfig, PolicyRuleConfig, ScopeRuleConfig } from "./config.js";

// Check #6: the policy engine. Combines signals from the other checks —
// tool sensitivity tier, output-tainting/provenance status (check #4),
// permission-scope violations (check #5), and tool-shadowing status
// (check #3) — into a final allow / flag / block decision per call. Rules
// are a configurable, ordered list (first match wins), so the policy
// itself isn't hardcoded the way milestone 3's "block if tainted and
// destructive" shortcut was.

export type Tier = "low" | "sensitive" | "critical";
export type Decision = "allow" | "flag" | "block";
export type ShadowStatus = "none" | "fuzzy" | "exact";

export interface PolicySignals {
  toolName: string;
  tier: Tier;
  tainted: boolean;
  matchedProvenanceIds: string[];
  scopeViolation: boolean;
  scopeReason?: string;
  shadowStatus: ShadowStatus;
  shadowDetail?: string;
}

export interface PolicyResult {
  decision: Decision;
  reasons: string[];
  matchedRule?: string;
}

const DEFAULT_RULES: PolicyRuleConfig[] = [
  { name: "block-ambiguous-shadowed-tool", if: { shadowStatus: "exact" }, decision: "block" },
  { name: "block-scope-violation", if: { scopeViolation: true }, decision: "block" },
  { name: "block-tainted-critical", if: { tier: "critical", tainted: true }, decision: "block" },
  { name: "flag-tainted-sensitive", if: { tier: "sensitive", tainted: true }, decision: "flag" },
  { name: "flag-fuzzy-shadowed-tool", if: { shadowStatus: "fuzzy" }, decision: "flag" },
];

const DEFAULT_DECISION: Decision = "allow";

/** Classifies a tool's sensitivity tier from an explicit config override, falling back to its MCP annotation hints. */
export function classifyTier(tool: Tool, config: PolicyConfig | undefined): Tier {
  const override = config?.tiers?.[tool.name];
  if (override) return override;

  if (tool.annotations?.destructiveHint === true) return "critical";
  if (tool.annotations?.readOnlyHint === false) return "sensitive";
  return "low";
}

/** Checks a tool call's arguments against configured scope rules (check #5: does this call match the tool's declared/permitted scope?). */
export function checkScopeViolation(
  toolName: string,
  args: Record<string, unknown> | undefined,
  config: PolicyConfig | undefined,
): { violation: boolean; reason?: string } {
  const rules = (config?.scopeRules ?? []).filter((r: ScopeRuleConfig) => r.tool === toolName);
  for (const rule of rules) {
    const value = (args ?? {})[rule.param];
    if (typeof value !== "string") continue;
    const pattern = new RegExp(rule.allow);
    if (!pattern.test(value)) {
      return {
        violation: true,
        reason: `argument "${rule.param}" (${JSON.stringify(value)}) does not match the allowed scope for tool "${toolName}" (expected to match ${rule.allow})`,
      };
    }
  }
  return { violation: false };
}

function ruleMatches(rule: PolicyRuleConfig, signals: PolicySignals): boolean {
  const cond = rule.if;
  if (cond.tier !== undefined && cond.tier !== signals.tier) return false;
  if (cond.tainted !== undefined && cond.tainted !== signals.tainted) return false;
  if (cond.scopeViolation !== undefined && cond.scopeViolation !== signals.scopeViolation) return false;
  if (cond.shadowStatus !== undefined && cond.shadowStatus !== signals.shadowStatus) return false;
  return true;
}

/** Evaluates the configured (or default) ordered rule list against a call's signals; first match wins. */
export function decidePolicy(signals: PolicySignals, config: PolicyConfig | undefined): PolicyResult {
  const rules = config?.rules ?? DEFAULT_RULES;
  const defaultDecision = config?.defaultDecision ?? DEFAULT_DECISION;

  for (const rule of rules) {
    if (ruleMatches(rule, signals)) {
      return { decision: rule.decision, matchedRule: rule.name, reasons: [describeSignals(rule.name, signals)] };
    }
  }

  return { decision: defaultDecision, reasons: [`no policy rule matched; default decision applies to tool "${signals.toolName}"`] };
}

function describeSignals(ruleName: string, signals: PolicySignals): string {
  const parts = [`rule "${ruleName}" matched for tool "${signals.toolName}"`, `tier=${signals.tier}`, `tainted=${signals.tainted}`];
  if (signals.tainted && signals.matchedProvenanceIds.length > 0) {
    parts.push(`provenance=${signals.matchedProvenanceIds.join(",")}`);
  }
  if (signals.scopeViolation && signals.scopeReason) parts.push(signals.scopeReason);
  if (signals.shadowStatus !== "none" && signals.shadowDetail) parts.push(signals.shadowDetail);
  return parts.join("; ");
}
