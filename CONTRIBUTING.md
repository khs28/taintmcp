# Contributing to taintmcp

Thanks for your interest in improving taintmcp. Bug reports, new attack examples, and pull requests are all welcome.

## Getting set up

You need Node.js 22.5 or newer (taintmcp uses the built-in `node:sqlite` module).

```bash
git clone https://github.com/khs28/taintmcp.git
cd taintmcp
npm install
npm run build
```

## Repository layout

| Path | What it is |
| ---- | ---------- |
| `packages/gateway` | The published `taintmcp` package: the gateway, every check, and the CLI |
| `packages/benign-server` | A trivial, well-behaved MCP server used as a test fixture |
| `packages/malicious-server` | A deliberately malicious MCP server used as a test fixture (never deploy it) |
| `packages/mock-agent` | A scripted stand-in for an AI agent, so demos need no API key |
| `packages/claude-agent` | A real LLM-backed agent for the end-to-end demo in [DEMOS.md](./DEMOS.md) |
| `scripts/` | Demo runners and the dashboard generator |
| `examples/` | Example gateway config files used by the demos |

## Checking your change

The scripted demos double as the test suite. Before opening a pull request, run:

```bash
npm run build
npm run demo
npm run demo:m2
npm run demo:m4
```

Each one prints `PASS` or `FAIL` and exits non-zero on failure. CI runs the same commands on every pull request.

If you're adding a new check or detection pattern, please add a case to the relevant demo (or a new demo script) that fails without your change and passes with it.

## Pull requests

- Keep each pull request focused on one change.
- Update the README or DEMOS.md if you change behaviour, CLI flags, or config options.
- Add a line to the "Unreleased" section of [CHANGELOG.md](./CHANGELOG.md).

## Reporting security issues

Please don't open public issues for bypasses or other vulnerabilities. See [SECURITY.md](./SECURITY.md).

## Code of conduct

This project follows the [Code of Conduct](./CODE_OF_CONDUCT.md). By participating you agree to uphold it.
