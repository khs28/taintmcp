import { readFile } from "node:fs/promises";
import { z } from "zod";

const GatewayConfigSchema = z.object({
  target: z.object({
    command: z.string(),
    args: z.array(z.string()).default([]),
  }),
});

export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;

export async function loadConfig(path: string): Promise<GatewayConfig> {
  const raw = await readFile(path, "utf-8");
  return GatewayConfigSchema.parse(JSON.parse(raw));
}
