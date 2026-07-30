import { readFile } from "node:fs/promises";
import { z } from "zod";

const TargetConfigSchema = z.object({
  id: z.string(),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
});

const GatewayConfigSchema = z.object({
  targets: z.array(TargetConfigSchema).min(1),
  storage: z
    .object({
      dbPath: z.string(),
    })
    .optional(),
});

export type TargetConfig = z.infer<typeof TargetConfigSchema>;
export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;

export async function loadConfig(path: string): Promise<GatewayConfig> {
  const raw = await readFile(path, "utf-8");
  return GatewayConfigSchema.parse(JSON.parse(raw));
}
