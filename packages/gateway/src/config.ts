import { readFile } from "node:fs/promises";
import { z } from "zod";

// A target is either a local process talked to over stdio (`command`/`args`/`env`)
// or a remote MCP server talked to over HTTP (`url`, optionally with `headers` for
// auth, e.g. `{ "Authorization": "Bearer ..." }`). Exactly one of the two shapes
// must be provided; `transport` only matters for the HTTP shape, to pick between
// the current Streamable HTTP spec and the older HTTP+SSE transport some servers
// still speak ("auto" tries Streamable HTTP first and falls back to SSE).
const TargetConfigSchema = z
  .object({
    id: z.string(),
    command: z.string().optional(),
    args: z.array(z.string()).default([]),
    env: z.record(z.string(), z.string()).optional(),
    url: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    transport: z.enum(["http", "sse", "auto"]).default("auto"),
  })
  .superRefine((target, ctx) => {
    if (!target.command === !target.url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `target "${target.id}" must specify exactly one of \`command\` (stdio) or \`url\` (HTTP), not both or neither`,
      });
    }
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
