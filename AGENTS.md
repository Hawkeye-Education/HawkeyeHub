## Agent skills

### Issue tracker

Issues live in GitHub Issues for `Hawkeye-Education/HawkeyeHub` (via `gh`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Coding standards

Read `CODING_STANDARDS.md` before writing or reviewing code. No optional fields or default values unless absence is a real domain state; validate at the boundary. Branching and PR targets: its Git section.

### Plugin standard

Read `PLUGIN_STANDARD.md` before writing or reviewing anything under `plugins/` or `stores/`: layout, Manifest, Plugin UI, Backend, Assistant, tests and publishing.
