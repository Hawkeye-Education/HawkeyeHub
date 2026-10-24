# Research: Existing formats for AI playbooks, skills and plugin tools

Resolves issue #4. Feeds the plugin-AI-surface decision (how HawkeyeHub plugins declare bots, playbooks and tools). **Facts and trade-offs only. This document makes no decision.**

Researched 2026-10-16 against primary sources (official specs, vendor docs, spec repos). Quotes are verbatim from the cited page.

## TL;DR

- **Playbooks/skills:** **Agent Skills** (`SKILL.md` + YAML frontmatter + optional `scripts/`, `references/`, `assets/`) is an open format. Anthropic created it and released it as an open standard. It is now the de facto cross-vendor format: OpenAI Codex/ChatGPT, GitHub Copilot/VS Code, Cursor, Gemini CLI, Mistral Vibe, Goose, OpenHands and 40+ other clients list support. The format itself does not depend on any model. The spec is small and stable, with Apache-2.0 code and CC-BY-4.0 docs.
- **Tools:** **MCP** (Model Context Protocol) is the cross-vendor protocol for exposing tools. It is MIT-licensed and governed under the Linux Foundation's Agentic AI Foundation (AAIF) since Dec 2025. The current revision is `2026-07-28`, a large breaking revision that made the protocol stateless. Tier-1 SDKs exist for **TypeScript and Python**. Tool input schemas are JSON Schema 2020-12, and every major provider's function-calling API accepts that shape.
- **Packaging (plugin = skills + tools + more):** there is **no single winner yet**.
  - The **Claude Code plugin** format (`.claude-plugin/plugin.json`) is the richest: skills, agents, hooks, MCP, LSP and more. It is Anthropic-defined.
  - **Agent Plugins 1.0.0** (`plugin.json` + `skills/` + `mcp.json`, published Aug 2026) is vendor-neutral. Its launch clients are ChatGPT/Codex, Cursor, Copilot, Kiro and VS Code. Claude Code is not listed. It deliberately covers **only skills and MCP servers**: agents, hooks and commands are out of scope.
  - OpenAI's plugin docs accept the Agent Plugins layout, their own `.codex-plugin/` layout, and "Claude-compatible" marketplaces.
- **Bot/agent persona definitions** (system prompt + model + tool allowlist) have **no cross-vendor standard**. Claude Code's `agents/*.md` frontmatter is the closest widely used convention, and it is Anthropic-specific.
- **AGENTS.md** is plain Markdown project context ("README for agents"). It has no schema and no tool or skill declaration, so it is not a plugin format.
- **Skills over MCP:** an official MCP extension (`io.modelcontextprotocol/skills`, SEP-2640 Final, Sep 2026) serves Agent Skills from an MCP server through `skills/list`, `skills/get` and `resources/read`. Host support is still early.

---

## 1. Agent Skills (`SKILL.md`)

Sources: spec <https://agentskills.io/specification>, overview <https://agentskills.io/home>, client guide <https://agentskills.io/client-implementation/adding-skills-support>, scripts guide <https://agentskills.io/skill-creation/using-scripts>, repo <https://github.com/agentskills/agentskills>

### File layout

```
skill-name/
├── SKILL.md          # Required: metadata + instructions
├── scripts/          # Optional: executable code
├── references/       # Optional: documentation
├── assets/           # Optional: templates, resources
└── ...
```

### Frontmatter (the whole spec)

| Field | Required | Constraint |
|---|---|---|
| `name` | Yes | ≤64 chars, `a-z0-9-`, no leading/trailing/double hyphen, **must match parent dir name** |
| `description` | Yes | ≤1024 chars. Says what the skill does and when to use it (this drives activation) |
| `license` | No | License name or bundled file |
| `compatibility` | No | ≤500 chars, environment requirements, e.g. "Requires Python 3.14+ and uv" |
| `metadata` | No | string→string map for client-specific extras |
| `allowed-tools` | No | Space-separated pre-approved tools. **"Experimental. Support for this field may vary between agent implementations"** |

The body is free-form Markdown. The recommended size is <5000 tokens and <500 lines.

### How tools/scripts are declared

- **They are not declared in a schema.** Scripts sit in `scripts/` and the Markdown body tells the agent to run them, e.g. `` `python3 scripts/process.py --input results.json` ``. The agent learns the interface from the prose and from `--help`.
- Recommended self-contained scripts: Python with **PEP 723** inline deps run via `uv run`, and TypeScript via **Deno** (`npm:` specifiers) or **Bun** auto-install. ([using-scripts](https://agentskills.io/skill-creation/using-scripts))
- Script conventions in the guide: no interactive prompts ("hard requirement"), `--help`, JSON to stdout and diagnostics to stderr, `--dry-run`, meaningful exit codes, bounded output size.
- Implication: a skill **assumes the host gives the model a shell / code-execution tool and a file-read tool** (or a dedicated `activate_skill` tool). The skill does not describe typed tools itself.

### Progressive disclosure (runtime model)

1. Catalog: `name` + `description` of every skill goes into the system prompt or a tool description (~50–100 tokens each).
2. Activation: the full `SKILL.md` body loads when the model or user picks the skill.
3. Resources: referenced files and scripts load or run only on demand.

### Implementing it in a non-Anthropic host (relevant to HawkeyeHub)

The client guide is written for any agent and any model. Key points:

- Scan `<project>/.<client>/skills/` and the cross-client convention **`.agents/skills/`** (project and user).
- Expose the catalog in the system prompt, **or** register a dedicated tool (e.g. `activate_skill`) whose `name` param is an enum of valid skills. The dedicated tool is "required when the model can't read files directly".
- Parse leniently: warn on name mismatch, skip only if the description is missing or the YAML is unparseable.
- Trust: gate project-level skills on a trust check. Protect skill content from context compaction.

### Provider neutrality, maturity, licensing

- **Neutral.** The format is plain files. Adoption list on agentskills.io includes Claude/Claude Code, **ChatGPT & Codex**, **GitHub Copilot**, **VS Code**, **Cursor**, **Gemini CLI**, **Mistral Vibe**, Goose, OpenHands, OpenCode, Junie (JetBrains), Kiro, Spring AI, Databricks, Snowflake, Factory, Roo Code, Letta and others.
- "Originally developed by Anthropic, released as an open standard … open to contributions from the broader ecosystem." No numbered spec version and no published releases on the repo. Governance is described only as "open to contributions" (CONTRIBUTING.md).
- License: **Apache-2.0 (code), CC-BY-4.0 (docs)** ([repo](https://github.com/agentskills/agentskills)).
- Validator: `skills-ref validate ./my-skill`.

### Vendor extensions to watch for (they break portability)

- **Claude Code** adds `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `disallowed-tools`, `model`, `effort`, `context: fork`, `agent`, `hooks`, `paths` and `shell`. It also adds substitutions such as `${CLAUDE_SKILL_DIR}`, `$ARGUMENTS` and `` !`cmd` `` (shell output injected before load). Its docs say that skills using these extensions get rejected "with an unexpected-key error" by "the Skills API, or other tools that follow only the standard". ([code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills))
- **Codex** keeps `SKILL.md` to `name` and `description` and puts extras in a sidecar **`agents/openai.yaml`**:
  - `interface.*` (display name, icons, `default_prompt`)
  - `policy.allow_implicit_invocation`
  - `dependencies.tools[]` (`type`, `value`, `description`, `transport`, `url`). The doc's example declares an MCP server dependency.
  - Codex searches `.agents/skills` (CWD, parents, repo root, `$HOME`), plus `/etc/codex/skills`.
  - Source: [learn.chatgpt.com/docs/build-skills](https://learn.chatgpt.com/docs/build-skills) (redirect target of developers.openai.com/codex/skills).
- **Claude API** custom skills run only inside Anthropic's code-execution container. They are uploaded via `/v1/skills`, have "no network access" and "no runtime package installation", and do not sync across Claude surfaces ([platform.claude.com … agent-skills/overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)). This is a hosted runtime that only Anthropic provides. The file format is the same.

---

## 2. MCP (Model Context Protocol), the tool-exposure protocol

Sources: spec <https://modelcontextprotocol.io/specification/latest> (resolves to `2026-07-28`), tools <https://modelcontextprotocol.io/specification/2026-07-28/server/tools>, changelog <https://modelcontextprotocol.io/specification/2026-07-28/changelog>, SDKs <https://modelcontextprotocol.io/docs/sdk>, governance <https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation>

### Model

- JSON-RPC 2.0 between **host** (LLM app) → **client** (connector) → **server**.
- Server features: **Tools** ("Functions for the AI model to execute"), **Resources** (data) and **Prompts** ("Templated messages and workflows for users").
- Client feature: **Elicitation** (ask the user for input).
- Transports: **stdio** (local subprocess) and **Streamable HTTP**. HTTP+SSE is deprecated.

### Tool declaration

A tool has `name`, optional `title`, `description`, `icons`, **`inputSchema`** (JSON Schema, defaults to **2020-12**, must be an object), optional **`outputSchema`**, and `annotations` ("MUST consider tool annotations to be untrusted unless they come from trusted servers").

Results contain `content[]` (text, image, audio, resource links, embedded resources) and/or `structuredContent`. They also carry `isError: true` for errors the model can self-correct. Discovery uses `tools/list`. Invocation uses `tools/call`.

Example of what a HawkeyeHub-style tool would look like on the wire (illustrative, shape per spec):

```json
{ "name": "test_regex_on_pdf",
  "description": "Run a regex against a sample PDF and return matches",
  "inputSchema": { "type": "object",
    "properties": { "pattern": {"type": "string"}, "pdfPath": {"type": "string"} },
    "required": ["pattern", "pdfPath"] } }
```

### `2026-07-28` revision (important for anyone implementing now)

From the changelog vs the previous `2025-11-25`:

- **Stateless:** the `initialize` handshake is removed. Every request carries its protocol version and capabilities in `_meta`. A new required `server/discover` RPC advertises the server's versions, capabilities and identity.
- Protocol-level sessions (`Mcp-Session-Id`) are removed. Cross-call state now uses explicit handles passed as tool args.
- The **Multi Round-Trip Requests** pattern (`resultType: "input_required"`) replaces server-initiated requests.
- **Roots, Sampling and Logging are deprecated.** For Sampling, the changelog says "integrate directly with LLM provider APIs instead".
- An `extensions` capability field exists for opt-in extensions: Tasks, MCP Apps (UI), Skills.
- A feature lifecycle policy now applies, with a minimum **12-month deprecation window**.
- Trade-off: this is a large breaking change. SDKs and hosts in the wild span both revisions, so check which revision the chosen SDK version implements.

### SDKs (official)

**Tier 1:** TypeScript (`modelcontextprotocol/typescript-sdk`), Python (`modelcontextprotocol/python-sdk`), C#, Go, Rust and Ruby. Java is Tier 2. Both HawkeyeHub backend languages are Tier 1.

### Provider neutrality

- The protocol does not depend on any model. The host translates MCP tools into whatever function-calling format the provider uses.
- Non-Anthropic consumers documented first-party:
  - The **OpenAI Agents SDK** supports `MCPServerStdio`, `MCPServerStreamableHttp`, `MCPServerSse` and `HostedMCPTool` ([docs/mcp.md](https://github.com/openai/openai-agents-python/blob/main/docs/mcp.md)).
  - The **Vercel AI SDK** (`@ai-sdk/mcp`, `createMCPClient` → `mcpClient.tools()`) "acts as an adapter between MCP tools and AI SDK tools" for its provider-agnostic `streamText` ([ai-sdk.dev](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools)).
- Adoption: Anthropic reports MCP is used by ChatGPT, Cursor, Gemini, Microsoft Copilot and VS Code, with >10,000 public servers.

### Governance and license

- Donated by Anthropic on **Dec 9, 2025** to the **Agentic AI Foundation (AAIF)**, a directed fund under the Linux Foundation. AAIF was co-founded by Anthropic, Block and OpenAI. Its founding projects are MCP, goose and AGENTS.md. "The Model Context Protocol's governance model will remain unchanged."
- Spec repo license: **MIT** ([github.com/modelcontextprotocol/modelcontextprotocol](https://github.com/modelcontextprotocol/modelcontextprotocol)).

### Skills over MCP (extension)

Source: <https://modelcontextprotocol.io/extensions/skills/overview>, charter <https://modelcontextprotocol.io/community/working-groups/skills-over-mcp>

- Extension id `io.modelcontextprotocol/skills`. **SEP-2640 is Final** (merged 2026-09-13).
- A server serves Agent-Skills-format skills via `skills/list`, `skills/get` and `resources/read` (`skill://name/SKILL.md`). Each skill has a file manifest with SHA-256 digests.
- The host MUST verify digests and frontmatter. It MUST treat skill content as untrusted, and "Host-side code execution and permission grants such as `allowed-tools` require explicit per-skill user approval."
- Explicitly **out of scope**: "Installable bundles (skills + servers + subagents + configuration as a single artifact)".
- Client support is early. The [client matrix](https://modelcontextprotocol.io/extensions/client-matrix) shows ChatGPT "Partial", fast-agent "Partial", MCP Inspector "Partial" and mcpc full. Claude, Cursor and VS Code show no Skills support yet.

---

## 3. Claude Code plugins

Sources: manifest reference <https://code.claude.com/docs/en/plugins-reference>, subagents <https://code.claude.com/docs/en/sub-agents>, skills <https://code.claude.com/docs/en/skills>

### Layout (defaults, all optional except the plugin dir)

```
my-plugin/
├── .claude-plugin/plugin.json   # optional manifest; only `name` required
├── skills/<name>/SKILL.md       # Agent Skills (+ Claude extensions)
├── commands/*.md                # legacy; "Prefer skills/ for new plugins"
├── agents/*.md                  # subagent definitions (bot personas)
├── hooks/hooks.json             # lifecycle hooks (PreToolUse, PostToolUse, …)
├── .mcp.json                    # MCP servers (tools)
├── .lsp.json                    # language servers
├── output-styles/, themes/, workflows/, monitors/monitors.json
├── bin/                         # added to the Bash tool's PATH
└── settings.json
```

### Manifest highlights

- `name` (kebab-case; it namespaces components, e.g. `deploy-tools:reviewer`), `version`, `description`, `author`, `license` (SPDX), `dependencies`.
- `userConfig` declares typed values that Claude Code prompts the user for. `sensitive: true` stores the value in the OS credential store. Values are referenced as `${user_config.KEY}` in MCP and LSP config, hook args, and skill and agent content.
- Path variables: `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}` (persists across updates) and `${CLAUDE_PROJECT_DIR}`.
- MCP servers can be inline, in `.mcp.json`, or as `.mcpb`/`.dxt` bundles. A stdio entry looks like `{ "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/server.js"] }`.
- Validator: `claude plugin validate`. Distribution goes through `marketplace.json` catalogs.

### Bot/agent definition (`agents/*.md`)

The Markdown body becomes the system prompt. Frontmatter: `name`, `description` (required), plus `tools`, `disallowedTools`, `model`, `skills` (preloaded), `mcpServers`, `hooks`, `maxTurns`, `effort`, `permissionMode` and others. For plugin agents, `hooks`, `mcpServers` and `permissionMode` are **ignored "for security reasons"**.

### Provider neutrality, maturity, licensing

- **Anthropic-defined, Claude-Code-specific runtime.** Model values (`sonnet`, `opus`, …), tool names (`Bash`, `Read`, …) and hooks are Claude Code concepts. The skills and MCP parts are portable. The manifest, agents and hooks are not standardized elsewhere, although OpenAI's plugin loader reads Claude-compatible marketplaces and passes `CLAUDE_PLUGIN_ROOT` to hooks (see §4).
- The format evolves fast: many fields are gated on specific Claude Code versions (e.g. "requires v2.1.281 or later"), and `experimental.*` keys "may still change". Docs do not state a license for the format itself.

---

## 4. OpenAI Codex / ChatGPT plugins and AGENTS.md

### Codex skills

See §1: standard `SKILL.md` plus an optional `agents/openai.yaml` sidecar. The page says skills "build on the open agent skills standard". Source: [learn.chatgpt.com/docs/build-skills](https://learn.chatgpt.com/docs/build-skills)

### Plugins

Sources: [learn.chatgpt.com/docs/plugins](https://learn.chatgpt.com/docs/plugins), [developers.openai.com/plugins/build/plugins](https://developers.openai.com/plugins/build/plugins)

- Plugins "bundle capabilities into reusable workflows in ChatGPT and Codex". Components: **Skills, MCP servers (optionally with custom UI), browser extensions, Hooks**.
- Two layouts:
  - **Portable (recommended):** root `plugin.json` with `$schema: https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`, root `mcp.json` and `skills/`. This is the Agent Plugins format (§5).
  - **Codex compatibility:** `.codex-plugin/plugin.json` + `.mcp.json`. It "remain[s] supported as a compatibility fallback".
- OpenAI-specific data lives under `extensions["com.openai"]`: `interface` (display, branding), `apps`, `hooks`, `onboardingSkill`, and per-server MCP `auth` (`none`/`oauth`/`api_key`/`mixed`).
- Marketplace: `.agents/plugins/marketplace.json` (repo or `~`), plus legacy-compatible `.claude-plugin/marketplace.json`. Sources can be `local`, `url`, `git-subdir` or `npm`.
- Claude compatibility: OpenAI "also accepts legacy and Claude-compatible manifests". Hooks receive `CLAUDE_PLUGIN_ROOT`/`CLAUDE_PLUGIN_DATA` as well as `PLUGIN_ROOT`/`PLUGIN_DATA`. The docs give no full compatibility matrix.
- Hooks: "apply only to manually installed Codex desktop plugins and make a plugin ineligible for the public directory". They also need user trust review.

### AGENTS.md

Source: <https://agents.md/>

- "AGENTS.md is just standard Markdown". There is **no schema and no required fields**, and it has no notion of tools, scripts or skills. It is a "README for agents" holding build, test and convention context.
- Nesting: "The closest AGENTS.md to the edited file wins; explicit user chat prompts override everything."
- Stewarded by the Agentic AI Foundation (Linux Foundation). It is supported by Codex, Copilot coding agent, Cursor, VS Code, Gemini CLI (with config), Jules, Factory, Amp, Zed, Warp, Devin and others.
- Relevance: this is a convention for *project context*, not a plugin, bot or tool format.

---

## 5. Agent Plugins 1.0.0 (vendor-neutral packaging)

Sources: spec <https://agent-plugins.org/specification>, site <https://agent-plugins.org/>, announcement <https://vercel.com/changelog/introducing-agent-plugins-1-0-0>, repo <https://github.com/agentplugins/agent-plugins-spec>

- **Status:** v1.0.0 "Published". The announcement is dated Aug 6, 2026. v1.1.0 is a working draft. The initial TSC has "Core Maintainers from Amazon, Cursor, Microsoft, OpenAI, and Vercel". Launch support: ChatGPT and Codex, Cursor, GitHub Copilot, Kiro and VS Code. **Claude Code is not listed.** The site says "openly licensed". The specific license was not visible in the fetched pages; it is in `LICENSE.md` in the repo.
- **Layout:** root `plugin.json` (required: `$schema`, `name`; optional: `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`, `extensions`), `skills/<name>/SKILL.md` (immediate children only) and root `mcp.json`.
- **`mcp.json`:** every server needs a `type`.
  - `stdio` takes `command`/`args`/`env`/`cwd`, with `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` expansion.
  - `streamable-http`/`sse` take `url`/`headers`. Non-loopback servers must use HTTPS.
  - Clients must support at least one of `stdio` or `streamable-http`.
- **Client-specific data:** an `extensions` object keyed by reverse-domain namespace, plus a same-named top-level folder. Clients ignore namespaces they don't implement.
- **Out of scope in v1:** "commands, hooks, agents, rules, and LSP servers". There is **no portable bot/agent persona definition**.

---

## Comparison

| | Agent Skills | MCP | Claude Code plugin | Codex/OpenAI plugin | Agent Plugins 1.0 | AGENTS.md |
|---|---|---|---|---|---|---|
| What it is | Playbook/skill folder format | Tool/resource protocol | Bundle: skills+agents+hooks+MCP+… | Bundle: skills+MCP+hooks+browser ext | Bundle: skills+MCP only | Project-context Markdown |
| Declares typed tools? | No (scripts + prose) | **Yes** (JSON Schema in/out) | Via MCP | Via MCP | Via MCP | No |
| Declares bot persona (prompt/model/tool allowlist)? | No | No | **Yes** (`agents/*.md`) | No | No (out of scope) | No |
| Python + TS backends | Scripts in any language | Tier-1 SDKs for both | Via MCP / scripts | Via MCP / scripts | Via MCP / scripts | n/a |
| Provider-neutral? | Yes (40+ clients) | Yes | Format is Claude-Code-specific; skills+MCP parts portable | OpenAI-specific extras under `extensions.com.openai` | Yes (by design) | Yes |
| Steward | agentskills.io (originated at Anthropic) | AAIF / Linux Foundation | Anthropic | OpenAI | Agent Plugins TSC (Amazon, Cursor, MS, OpenAI, Vercel) | AAIF / Linux Foundation |
| License | Apache-2.0 / CC-BY-4.0 | MIT | Not stated | Not stated | "openly licensed" (see repo) | n/a |
| Maturity | Small, unversioned spec; broad adoption | Versioned (`2026-07-28`), breaking rev just landed; 12-mo deprecation policy | Fast-moving, version-gated fields | Active; two layouts | 1.0.0 published Aug 2026; 1.1 draft | Stable convention |

## Trade-offs relevant to HawkeyeHub (inputs to the decision, not a decision)

1. **Skills need a host-side execution surface.** Running a skill's `scripts/` means the Hub must give the bot a shell/code-exec tool (with sandboxing and consent) or a dedicated `activate_skill` + run-script tool. The format does not provide typed tool contracts. "Draft a regex and test-run it on a sample PDF" could be a skill script or an MCP tool. Only MCP gives a JSON-Schema-typed call that any provider's function calling accepts directly.
2. **MCP fits mixed Python/TS backends.** Tier-1 SDKs exist in both languages. stdio fits locally spawned plugin backends in Electron. The cost is implementing an MCP client in the Hub and translating MCP tools to each provider's tool format. Off-the-shelf adapters exist, e.g. Vercel AI SDK `@ai-sdk/mcp` and OpenAI Agents SDK. The `2026-07-28` statelessness change matters when choosing SDK versions.
3. **Packaging is the unsettled layer.**
   - Agent Plugins 1.0 is the only vendor-neutral bundle spec. It covers just skills + MCP, and Claude Code isn't a launch client.
   - Claude Code's format covers bot personas (`agents/*.md`), hooks and user config (`userConfig` with secure storage) but is vendor-specific.
   - Every format leaves room for vendor data: Agent Plugins `extensions` namespaces, Claude Code `metadata`, Agent Skills `metadata`, Codex `agents/openai.yaml`. A Hub-specific bot definition could live in such an extension slot without breaking the portable core.
4. **Vendor extensions break portability.** Claude-Code-only `SKILL.md` keys are rejected by strict validators (Claude Code's own docs say so). Sticking to the six standard frontmatter keys keeps skills loadable everywhere.
5. **Bot personas have no standard.** A system prompt + model choice + tool allowlist per mini-app bot is not covered by any neutral spec. Claude Code `agents/*.md` (Markdown body = system prompt, YAML frontmatter) is the most widely seen shape, but its `model` and `tools` values are Claude-Code vocabulary.
6. **Security posture is specified for you.** The MCP spec, the Skills-over-MCP extension and the Agent Skills client guide all require or recommend treating skill and tool metadata as untrusted, user consent before tool invocation and code execution, and trust-gating project-level skills.

## Open questions (not answered by the sources)

- The exact license text of the Agent Plugins spec (repo `LICENSE.md` not rendered in fetch).
- Whether Anthropic plans to adopt Agent Plugins in Claude Code. No primary source found either way.
- Agent Skills spec versioning and governance beyond "open to contributions". No releases or tags are published.
