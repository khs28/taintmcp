# taintmcp — Project Brief

Read this whole brief before writing any code.

## What this project is

taintmcp is a runtime, client-side security gateway for the Model Context
Protocol (MCP). It sits between an AI agent and any MCP server (or servers),
transparently proxying every message in both directions so it can inspect,
tag, and — when necessary — block traffic before it reaches the agent's
context window.

## The problem it solves

AI agents that use MCP tools are vulnerable to **indirect prompt injection**:
a malicious or compromised MCP server can return tool output (e.g. the text
of a webpage, a file, a database record) containing hidden instructions,
which the agent may mistake for a legitimate command and act on — e.g.
exfiltrating data via a completely legitimate `send_email` tool it already
has access to, triggered by nothing the user actually asked for.

Related, well-documented attack classes in the same space:
- **Tool poisoning** — malicious instructions embedded in a tool's own
  description/metadata, invisible to the user but read by the model.
- **Rug pulls** — a tool's definition changes after it's already been
  trusted/approved, introducing malicious behavior later.
- **Tool shadowing** — a malicious server registers a tool with a name
  confusingly similar to a legitimate one, intercepting calls meant for it.

## The gap this project fills

Nearly all existing public work in this space demonstrates the problem
rather than solving it at runtime:
- **Damn Vulnerable MCP Server** and similar projects are educational —
  built to show these attacks succeeding, not to stop them.
- Security vendor writeups (Microsoft, Snyk, Unit 42, Elastic) document
  these attack classes and recommend mitigations (e.g. "wrap untrusted
  content in tags so the model treats it as data, not commands") — but
  as manual advice a developer has to remember to implement themselves,
  per tool, every time.
- The one tool that runs continuously (an MCP security-scanning GitHub
  Action) does **static analysis of server source code before
  deployment** — it can't catch a rug pull that happens after deployment,
  and it can't help with third-party servers whose source isn't available.
- Academic literature on MCP security explicitly notes that client-side
  defenses are far less explored than server-side vulnerabilities and
  attacker frameworks.

taintmcp is the runtime, protocol-level, server-agnostic defense layer:
it automates the "treat untrusted content as data, not commands" mitigation
instead of relying on every developer to hand-implement it correctly, and
adds **provenance tracking** — tracing whether a sensitive tool call was
influenced by untrusted content several steps earlier in the conversation —
which does not currently exist as a working, general-purpose tool.

Honest framing for the README/any writeup: this is not "the first defense
that has ever existed" — the mitigation *concept* is published guidance.
The contribution is turning that guidance into an automatic, always-on,
drop-in layer, plus the provenance-tracking piece, which is genuinely new.

## How it works, mechanically

taintmcp presents itself as an MCP **server** to the agent, and as an MCP
**client** to the real downstream server(s). All protocol traffic (JSON-RPC
over stdio or HTTP/SSE) passes through it in both directions, so it can
inspect and rewrite messages without either side needing to know it's there.

## The six checks

1. **Schema/description scanner** — at connection time, scans every tool's
   name/description/parameter schema for suspicious patterns before it's
   ever shown to the agent: imperative command language ("always,"
   "ignore previous," "system:"), hidden/invisible Unicode characters,
   description-vs-parameter mismatches.
2. **Rug-pull detector** — hashes each tool's full schema/description on
   first connection, stores it, and diffs against the stored hash on every
   subsequent connection. Flags any silent change to a previously-trusted
   tool.
3. **Tool shadowing detector** — across all currently connected servers,
   flags exact or fuzzy (e.g. Levenshtein-distance) name collisions between
   tools.
4. **Output tainting + provenance tracking** — the flagship feature. Every
   tool *response* is wrapped in explicit untrusted-content markers before
   being relayed to the agent, and assigned a provenance ID. If that
   content later influences another tool call (directly or through the
   conversation), the provenance chain is logged so it can be traced.
5. **Permission scope enforcer** — checks whether an outgoing tool call's
   provenance chain includes tainted content, and whether the call's actual
   parameters match the tool's declared capability/scope.
6. **Policy engine** — combines signals from the above into a final
   decision per tool call: allow / flag-for-human-review / block. Rules are
   configurable (e.g. "any sensitive-tier tool call with tainted provenance
   requires approval").

## Tech stack

- **TypeScript + Node.js**
- **`@modelcontextprotocol/sdk`** (official MCP SDK) — used for both the
  gateway's server-facing facade and its client-facing facade
- **better-sqlite3** — three simple tables: tool schema snapshots,
  provenance log, policy decisions
- **Anthropic API (Claude)** — powers the real test agent used in later
  milestones to prove attacks succeed without the gateway and fail with it
- **commander** — CLI (`taintmcp start --config gateway.json`)
- **Test fixtures**: one benign MCP server (trivial tool, e.g.
  `get_weather`), and one deliberately malicious MCP server we build
  ourselves (attack patterns may be conceptually informed by public
  research like Damn Vulnerable MCP Server, credited in the README — not
  forked or copied)

## How I want to work with you

Go step by step, one milestone at a time. After each milestone, stop, show
me what you built, explain what it does and how to run/test it, and wait
for my feedback before moving to the next milestone. Do not skip ahead or
build multiple milestones in a single pass. If anything in this brief is
ambiguous, or you think there's a better technical approach than what's
described, ask me before assuming.

## Milestones, in order

**Milestone 1 — Plumbing**
Gateway starts, acts as an MCP server to a scripted/mocked agent (no real
LLM calls yet — zero API cost), connects as a client to one real benign
MCP server (e.g. `get_weather`), and a full round-trip tool call works
end to end with zero inspection logic. This proves the proxy plumbing
works before any security logic is added.

**Milestone 2 — Schema scanner + rug-pull detector**
Build the malicious test server fixture (starting with one poisoned tool
description). Implement checks #1 and #2. Demonstrate: a poisoned
description gets flagged; a schema that silently changes between two
runs gets caught.

**Milestone 3 — Output tainting + provenance tracking (flagship)**
Add an indirect-injection payload to the malicious server's tool output
(not just its description — its *response*). Wire in a real Claude agent.
Show, with a full logged transcript: the agent falls for the attack with
the gateway off, and gets blocked with the gateway on. This is the core
demo for the README.

**Milestone 4 — Tool shadowing detector + policy engine**
Implement check #3. Build the configurable policy engine (check #6) that
ties together taint status, tool sensitivity tier, and scope violations
into a final block/flag/allow decision.

**Milestone 5 — Dashboard / log viewer**
A simple static HTML (or minimal page) reading the SQLite log, so
provenance chains, rug-pull diffs, and policy decisions are visually
demoable — this matters for showing the project in an interview.

**Milestone 6 — README + writeup**
Explicitly names the gap this fills, cites relevant public research (OWASP
MCP Top 10, the client-side security gap noted in academic literature on
MCP), and leads with the before/after transcript from Milestone 3.

Start with Milestone 1 only. Ask me any clarifying questions first if you
have them, then scaffold it.
