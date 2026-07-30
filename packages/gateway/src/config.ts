import { readFile } from "node:fs/promises";
import { z } from "zod";

const TargetConfigSchema = z.object({
  id: z.string(),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
});

const TierSchema = z.enum(["low", "sensitive", "critical"]);
const DecisionSchema = z.enum(["allow", "flag", "block"]);
const ShadowStatusSchema = z.enum(["none", "fuzzy", "exact"]);

// check #5: scope rules. "This tool's `param` argument must match `allow`
// (a regex) or the call is out of the tool's permitted scope" — e.g.
// restricting which recipient domains send_email may be called with.
const ScopeRuleConfigSchema = z.object({
  tool: z.string(),
  param: z.string(),
  allow: z.string(), // regex source, tested against the argument's string value
});

// check #6: an ordered rule list for the policy engine — first match
// wins. Every condition field is optional; omitted fields aren't checked.
const PolicyRuleConfigSchema = z.object({
  name: z.string(),
  if: z.object({
    tier: TierSchema.optional(),
    tainted: z.boolean().optional(),
    scopeViolation: z.boolean().optional(),
    shadowStatus: ShadowStatusSchema.optional(),
  }),
  decision: DecisionSchema,
});

const PolicyConfigSchema = z.object({
  tiers: z.record(z.string(), TierSchema).optional(),
  scopeRules: z.array(ScopeRuleConfigSchema).optional(),
  rules: z.array(PolicyRuleConfigSchema).optional(),
  defaultDecision: DecisionSchema.optional(),
});

const GatewayConfigSchema = z.object({
  targets: z.array(TargetConfigSchema).min(1),
  storage: z
    .object({
      dbPath: z.string(),
    })
    .optional(),
  policy: PolicyConfigSchema.optional(),
});

export type TargetConfig = z.infer<typeof TargetConfigSchema>;
export type ScopeRuleConfig = z.infer<typeof ScopeRuleConfigSchema>;
export type PolicyRuleConfig = z.infer<typeof PolicyRuleConfigSchema>;
export type PolicyConfig = z.infer<typeof PolicyConfigSchema>;
export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;

export async function loadConfig(path: string): Promise<GatewayConfig> {
  const raw = await readFile(path, "utf-8");
  return GatewayConfigSchema.parse(JSON.parse(raw));
}
