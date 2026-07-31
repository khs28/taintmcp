export { startGateway, connectDownstreams, inspectTools, logInspectionReport, logShadowReport } from "./gateway.js";
export type { RunningGateway, InspectionReport, ToolInspection, DownstreamConnection } from "./gateway.js";
export { loadConfig } from "./config.js";
export type { GatewayConfig, TargetConfig, PolicyConfig, PolicyRuleConfig, ScopeRuleConfig } from "./config.js";
export {
  openStore,
  getSnapshot,
  listPolicyDecisions,
  listScanFindings,
  listRugPullEvents,
  listShadowFindings,
  listProvenanceLog,
  listToolSnapshots,
} from "./storage.js";
export type {
  ToolSnapshot,
  PolicyDecisionEntry,
  ScanFindingEntry,
  RugPullEventEntry,
  ShadowFindingEntry,
  ProvenanceLogEntry,
} from "./storage.js";
export { scanTool } from "./scanner.js";
export type { ScanFinding } from "./scanner.js";
export { checkRugPull, hashTool } from "./rugpull.js";
export type { RugPullResult } from "./rugpull.js";
export { generateProvenanceId, checkCallProvenance, wrapWithProvenance, extractResponseText } from "./provenance.js";
export type { TaintedResponse, TaintCheckResult } from "./provenance.js";
export { checkToolShadowing, exactlyShadowedNames, fuzzilyShadowedNames } from "./shadow.js";
export type { NamedTool, ShadowFinding } from "./shadow.js";
export { classifyTier, checkScopeViolation, decidePolicy } from "./policy.js";
export type { Tier, Decision, ShadowStatus, PolicySignals, PolicyResult } from "./policy.js";
