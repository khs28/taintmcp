import { readFile } from "node:fs/promises";
import { z } from "zod";

const GatewayConfigSchema = z.object({
  listenPort: z.number().int().positive(),
  target: z.object({
    url: z.string().url(),
  }),
});

export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;

export async function loadConfig(path: string): Promise<GatewayConfig> {
  const raw = await readFile(path, "utf-8");
  return GatewayConfigSchema.parse(JSON.parse(raw));
}
