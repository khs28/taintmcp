#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { startGateway } from "./gateway.js";

const program = new Command();

program
  .name("taintmcp")
  .description("taintmcp: a runtime, client-side security gateway for MCP")
  .version("0.1.0");

program
  .command("start")
  .description("Start the gateway: MCP server facade to the agent, MCP client facade to the downstream server")
  .requiredOption("-c, --config <path>", "Path to a gateway config JSON file")
  .action(async (opts: { config: string }) => {
    const config = await loadConfig(opts.config);
    await startGateway(config);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error("[gateway] fatal error:", err);
  process.exit(1);
});
