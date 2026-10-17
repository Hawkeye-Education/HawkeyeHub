# Playbooks are Agent Skills, loaded whole, with no scripts

A plugin's **Playbook** is a set of **Skills** in the open Agent Skills format: `skills/<name>/SKILL.md` at the plugin root (the Agent Plugins 1.0 layout), with only the six standard frontmatter keys and optional `references/` and text `assets/`. The Hub loads every Skill's body and references into the **Assistant**'s context for every conversation, after a fixed Hub preamble and the plugin's own system prompt (`assistant.md`, named by the manifest). A Skill containing `scripts/`, or frontmatter beyond the standard keys, fails packaging (`skills-ref validate` plus our checks).

We chose the format over plain Markdown files so that plugin developers write Playbooks in a format they already know, and can try them in Claude, Codex or any other Agent Skills client before shipping. We chose to drop the format's two runtime features. On-demand activation (a catalog of descriptions plus an `activate_skill` tool) and running `scripts/` both need tool calls, which [ADR 0001](0001-plugin-assistants-advise-never-operate.md) rules out. So the Hub loads everything, and `description` is just documentation. This only works while Playbooks stay small. The provider's context-length error is the only limit; the Hub sets no cap of its own.

## Consequences

- If Playbooks outgrow the context, a catalog plus a read-only `activate_skill` tool can be added without changing any Skill on disk. It would amend ADR 0001, since it is a tool call even though it only reads the plugin's own Playbook.
- Vendor frontmatter (Claude's `model`, `allowed-tools`, Codex's `agents/openai.yaml`) is rejected rather than ignored, so a Playbook that packages for the Hub loads unchanged everywhere else.
- Playbooks change only through a plugin release; staff cannot add or edit Skills.
