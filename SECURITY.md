# Security Policy

taintmcp is a security tool, so reports of ways to get around it are especially welcome.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Instead, report them privately through [GitHub Security Advisories](https://github.com/khs28/taintmcp/security/advisories/new).

Useful things to include:

- Which check is affected (schema scanner, rug-pull detector, shadowing detector, output tainting/provenance, scope enforcement, or the policy engine)
- A minimal tool schema, tool output, or MCP server that demonstrates the bypass
- The taintmcp version, Node.js version, and the config you used (with secrets removed)

You can expect an acknowledgement within a few days. Once a fix is released, the advisory will be published with credit to the reporter unless you'd prefer to stay anonymous.

## Scope

In scope: anything that lets a malicious MCP server or tool output get a call past taintmcp that its configured policy should have flagged or blocked, or that crashes or hangs the gateway.

Out of scope: the deliberately vulnerable test fixture in `packages/malicious-server`, which exists only to exercise taintmcp's defenses and must never be deployed.
