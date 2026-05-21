# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial project scaffold: TypeScript, ESM, Node 22 target.
- Entrypoint stub with transport selection (`stdio` | `http`).
- Lazy-loading tool registry skeleton for hierarchical action routing.
- Planning Center REST client skeleton (PAT auth) with rate limiting hook.
- `pcs_info` tool with `whoami` and `list_service_types` actions.
- Environment-driven configuration loader.
- PRD captured under `.taskmaster/docs/prd.txt`; 20 tasks generated.
