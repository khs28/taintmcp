# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0]

First public release.

### Added

- Stdio gateway that sits between an MCP client and one or more downstream MCP servers
- Downstream servers over stdio, Streamable HTTP, or HTTP+SSE (auto-detected)
- Schema/description scanner for tool poisoning
- Rug-pull detector that diffs tool definitions against a stored baseline
- Tool shadowing detector for exact and typosquatted tool names across servers
- Output tainting and provenance tracking for indirect prompt injection
- Permission scope rules and a configurable allow / flag / block policy engine
- `taintmcp wrap` for zero-config protection of a single server, plus `init` and `start` for config-file setups
- SQLite audit log and a static HTML dashboard

[Unreleased]: https://github.com/khs28/taintmcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/khs28/taintmcp/releases/tag/v0.1.0
