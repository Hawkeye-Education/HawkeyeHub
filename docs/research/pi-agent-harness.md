# Research: Pi vs LangGraph.js as the Hub's agent harness

Resolves #15. Feeds **AI provider layer** and **Plugin AI surface: bots, playbooks and tools**. **Facts only. This doc makes no decision.**

Researched 2026-10-16 against primary sources: repo source at pinned commits, READMEs, CHANGELOGs, `package.json`, npm registry metadata, GitHub API stats and official docs. Pinned commits:

- Pi: `earendil-works/pi` @ [`4dd2b14`](https://github.com/earendil-works/pi/tree/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24) (2026-10-16), packages at **1.3.0**
- LangGraph.js: `langchain-ai/langgraphjs` @ [`6180711`](https://github.com/langchain-ai/langgraphjs/tree/61807113665e4875c6ec8fd34c6f6c9f7becf497) (2026-10-15), `@langchain/langgraph` **1.5.0**

Below, `P/` is short for `https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/` and `L/` is short for `https://github.com/langchain-ai/langgraphjs/blob/61807113665e4875c6ec8fd34c6f6c9f7becf497/`. Links in the text are full URLs.

## TL;DR

- **Pi has moved and been renamed.** `badlogic/pi-mono` now redirects to **`earendil-works/pi`**, owned by the Earendil Works org. The npm scope changed from `@mariozechner/*` to **`@earendil-works/*`**, and every `@mariozechner/pi-*` package is deprecated at 0.73.1 with "please use @earendil-works/… instead". Version 1.0.0 shipped on 2026-10-01.
- **Pi is now a layered toolkit**:
  - `pi-ai`: a provider abstraction.
  - `pi-agent-core`: a small in-memory tool loop of about 2.5k LOC.
  - `pi-durable`: a separate harness of about 25k LOC with checkpointed tasks, crash resume, subagents and a task graph. It is labelled **"Experimental. The API changes without notice."**
  - `pi-mcp`: a standalone MCP client.
  - `pi-coding-agent`: the CLI/SDK. This is where **Agent Skills** loading lives.
  - Smaller packages: `pi-codemode`, `chord` and `pi-tui`.
- **What `pi-agent-core` lacks compared with LangGraph:** persisted checkpoints, a pause/resume-with-human-answer primitive, and declarative multi-agent graphs. It does have in-process tool-call gating (`beforeToolCall`), steering, follow-ups and abort. **`pi-durable` covers checkpointing, resume and subagent/child-task trees.** I found no documented durable "interrupt for human input, resume later" primitive equivalent to LangGraph's `interrupt()` + `Command({ resume })`, and no declarative graph DSL.
- **LangGraph.js provides all four gaps natively**:
  - checkpointers: memory, SQLite, Postgres, Redis, MongoDB
  - `interrupt()` HITL, plus `langchain`'s approve/edit/reject/respond middleware
  - `StateGraph`, subgraphs, and the supervisor and swarm packages
  - It brings `@langchain/core`, zod, langsmith and js-tiktoken. Its SQLite checkpointer is **`better-sqlite3`, a native addon**.
- **Gateway and local models:** both can target an OpenAI-compatible gateway and Ollama. In pi-ai this is done with `createProvider()` and `compat` flags; the README names LiteLLM explicitly. LangGraph does it through `@langchain/openai`'s `baseURL`.
- **Hub use cases mapped:** the regex bot, chat-with-tools and voice→KB, as described, need a tool loop, streaming, tool gating and conversation persistence. None of them as described needs a graph or a durable pause. **Neither Pi nor LangGraph does ASR**, and pi-ai has no embeddings API.
- **Stability and maintenance:**
  - Pi is very active: ~592 commits in 30 days and releases every 1–5 days. It has 3 core committers.
  - Pi ships **breaking changes in minor and patch releases even after 1.0**.
  - LangGraph.js is slower-moving (4–28 commits/week), company-backed, and on 1.x.

---

## 1. What Pi is today (package map)

| Package (npm, v1.3.0, all MIT) | Role | Direct runtime deps |
|---|---|---|
| `@earendil-works/pi-ai` | Unified multi-provider LLM API: stream/complete, tools, thinking, auth, model catalog | `@anthropic-ai/sdk`, `openai`, `@google/genai`, `@aws-sdk/client-bedrock-runtime`, `@smithy/node-http-handler`, proxy agents, `partial-json`, `typebox`, `pi-telemetry` ([package.json](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/ai/package.json#L69-L80)) |
| `@earendil-works/pi-agent-core` | `Agent` class and `agentLoop()`: tool execution, events, steering. "now contains only `Agent`, the agent loop, the proxy stream, and their types" ([CHANGELOG 1.0.0](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/agent/CHANGELOG.md#L27-L31)) | `pi-ai`, `typebox` ([package.json](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/agent/package.json#L25-L28)) |
| `@earendil-works/pi-durable` | "A durable agent harness … If the process dies mid-turn, reopening the storage picks the work up where it stopped." **Experimental** ([README](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/durable/README.md#L3-L5)) | `chord`, `pi-ai`, `pi-codemode`, photon (WASM images), `diff`, `typebox` ([package.json](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/durable/package.json#L145-L152)) |
| `@earendil-works/pi-mcp` | "small, standalone Model Context Protocol client. It does not depend on the official MCP SDK" ([README](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/mcp/README.md#L3)) | `cross-spawn` only |
| `@earendil-works/pi-codemode` | QuickJS sandbox where model-written JS calls tools | `quickjs-wasi` |
| `@earendil-works/pi-coding-agent` | The `pi` CLI and its TypeScript SDK (`createAgentSession`). Owns sessions (JSONL), extensions, **skills**, prompt templates and MCP config | 22 direct deps ([package.json](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/coding-agent/package.json#L42-L65)) |
| `@earendil-works/chord`, `pi-tui`, `pi-telemetry`, `pi-env` | Plugin runtime/replicated state, terminal UI, telemetry contracts, remote exec env | — |

The project describes itself as "a minimal, extensible agent harness". It "ships with powerful defaults but skips features like sub-agents and plan mode" ([README L15-19](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/README.md#L15-L19)). It "does not include a built-in permission system for restricting filesystem, process, network, or credential access" ([README L88-96](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/README.md#L88-L96)). That statement applies to the CLI's built-in tools.

## 2. Side-by-side

| Dimension | Pi (`pi-ai` + `pi-agent-core`, optionally `pi-durable`) | LangGraph.js (`@langchain/langgraph` + `@langchain/core`) |
|---|---|---|
| Provider abstraction | Own wire implementations for `anthropic-messages`, `openai-completions`, `openai-responses`, Google, Vertex, Mistral and Bedrock. Lists ~35 providers plus "Any OpenAI-compatible API: Ollama, vLLM, LM Studio" ([ai README L60-96](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/ai/README.md#L60-L96)). Cross-provider handoff in one context ([L1499-1539](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/ai/README.md#L1499-L1539)) | Via LangChain chat-model packages (`@langchain/openai`, `@langchain/ollama` 1.3.0, …), not part of LangGraph itself |
| Tool calling + schema | TypeBox schemas, validated with TypeBox. Optional strict / grammar-constrained sampling ([L506-572](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/ai/README.md#L506-L572)). `AgentTool.execute(id, params, signal, onUpdate)` ([agent README L451-486](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/agent/README.md#L451-L486)) | `@langchain/core` tools (zod / Standard Schema), `ToolNode` |
| Streaming | Event stream for text, thinking and tool-call deltas, with partial JSON args ([L136-184](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/ai/README.md#L136-L184)). Agent events `message_update`, `tool_execution_update` ([agent README L185-198](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/agent/README.md#L185-L198)) | Graph `stream()` modes (values/updates/messages/custom) |
| Multi-turn state | `agent.state.messages` held in memory. `Context` is plain JSON: "easily serialized … persist conversations" ([L1574-1605](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/ai/README.md#L1574-L1605)) | Typed graph state with reducers (`Annotation`, `messagesStateReducer`), persisted per thread by a checkpointer |
| Interruption / HITL | `abort()`, `steer()`, `followUp()` ([agent README L366-422](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/agent/README.md#L366-L422)). Async `beforeToolCall` can block a call ([L241-246](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/agent/README.md#L241-L246)). Not persisted | `interrupt(value)` pauses a node and `Command({ resume })` continues. **Requires a checkpointer** ([interrupt.ts L39-108](https://github.com/langchain-ai/langgraphjs/blob/61807113665e4875c6ec8fd34c6f6c9f7becf497/libs/langgraph-core/src/interrupt.ts#L39-L108)) |
| Persistence / resume | agent-core: none built in (removed in 1.0.0). coding-agent: JSONL `SessionManager` ([sdk.md L38](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/coding-agent/docs/sdk.md#L38)). **pi-durable**: checkpointed tasks, `harness.resume()`, SQLite/JSONL storage ([durable README L103-126](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/durable/README.md#L103-L126)) | Checkpointer packages: memory (`MemorySaver`), SQLite, Postgres, Redis, MongoDB (`libs/checkpoint*`, all 1.x, MIT) |
| Multi-agent | agent-core: none. pi-durable: subagent tools, task-owned child conversations, child tasks, task-ownership graph ([L540-628](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/durable/README.md#L540-L628)) | `StateGraph` nodes, edges and conditional edges, subgraphs. `@langchain/langgraph-supervisor` 1.1.3, `@langchain/langgraph-swarm` 1.0.4 |
| MCP | `pi-mcp` (stdio + Streamable HTTP + OAuth). Protocol `2025-11-25` | `@langchain/mcp-adapters` 2.0.1 |
| Agent Skills (`SKILL.md`) | Implemented in **pi-coding-agent** (loader exported). Not in agent-core | Not in LangGraph. `deepagents` (JS) has a skills loader and middleware |
| Licence | MIT (all packages) | MIT (LangGraph, checkpointers, supervisor, swarm, mcp-adapters, deepagents) |

## 3. Detail per dimension

### 3.1 Provider abstraction, company gateway and local models

- **OpenAI-compatible gateway (LiteLLM).** `createProvider()` builds a provider from an id, auth, models and an API implementation, "for local inference servers, proxies, or any OpenAI/Anthropic-compatible endpoint". A mixed-API gateway can route per model to `openai-completions`, `openai-responses` or `anthropic-messages` ([ai README L1191-1256](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/ai/README.md#L1191-L1256)). The `compat` block lists **"LiteLLM proxies: May not support `store` field"** as a use case for overriding flags ([L1364-1410](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/ai/README.md#L1364-L1410)).
- **Auth from the staff login.** There are several hooks for feeding a login token in:
  - Provider auth is an async `resolve()`.
  - `Models.stream*()` accepts `transformHeaders`, run after auth and before dispatch ([L403-425](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/ai/README.md#L403-L425)).
  - The `CredentialStore` is injectable ([L427-439](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/ai/README.md#L427-L439)).
  - `Agent` takes `getApiKey: async (provider) => …` "for expiring OAuth tokens" ([agent README L235-236](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/agent/README.md#L235-L236)).
  - `streamProxy()` routes model calls through a backend URL with an `authToken` ([L510-525](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/agent/README.md#L510-L525)).
- **Corporate proxy.** `HTTP_PROXY`/`HTTPS_PROXY` can be scoped per request via `env` ([L1691-1708](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/ai/README.md#L1691-L1708)).
- **Ollama.** There is a worked `createProvider` example at `http://localhost:11434/v1`. The README advises `compat.supportsDeveloperRole: false` and `supportsReasoningEffort: false` for Ollama/vLLM/SGLang ([L1201-1228](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/ai/README.md#L1201-L1228), [L1303](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/ai/README.md#L1303)). Dynamic model lists use `fetchModels` + `models.refresh()` ([L1277-1293](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/ai/README.md#L1277-L1293)).
- **Model types.** Chat, `image` and `classifier` ([L293-303](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/ai/README.md#L293-L303)). The README documents **no audio/ASR and no embeddings API**.
- **Grammar-constrained regex tools.** OpenAI "regex grammar variants" are emitted only where `compat.supportsOpenAIGrammarTools` is set: GPT-5+ on OpenAI-family endpoints. Elsewhere the call falls back to normal function tools, and "gateways that normalize tool schemas … mangle them" ([L556](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/ai/README.md#L556)). This feature constrains the *tool argument* grammar. It does not validate a regex the bot drafts.
- **LangGraph.** Model access goes through LangChain integrations. `@langchain/openai`'s `ChatOpenAI` takes a `baseURL` ([source](https://github.com/langchain-ai/langchainjs/blob/main/libs/providers/langchain-openai/src/chat_models/base.ts)), and `@langchain/ollama` 1.3.0 exists (npm).

### 3.2 Tools: native vs MCP

- **Native (Pi).** An `AgentTool` is an object with a TypeBox `parameters` schema and an `execute()`. `execute()` gets an `AbortSignal` and an `onUpdate` progress callback. A thrown error becomes `isError: true` for the model. Tools can run `parallel` (the default) or `sequential` per tool ([agent README L109-122](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/agent/README.md#L109-L122), [L451-504](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/agent/README.md#L451-L504)). A Python plugin tool would be an `execute()` that spawns the bundled Python. `pi-durable`'s `NodeExecutionEnv.exec(argv)` "runs a program without a shell" ([durable README L347-356](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/durable/README.md#L347-L356)).
- **MCP (Pi).**
  - `pi-mcp` has a `StdioTransport` (`command`/`args`) and `StreamableHttpTransport`. The README shows wrapping each MCP tool as an `AgentTool` ([mcp README L7-56](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/mcp/README.md#L7-L56)).
  - Supported surface: protocol **`2025-11-25`** (accepting 2025-06-18, 2025-03-26 and 2024-11-05), tools list/call, progress, cancellation, OAuth. "Batch JSON-RPC messages, legacy HTTP+SSE, servers, sampling, and tasks are outside the initial core" ([L109-124](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/mcp/README.md#L109-L124); [`LATEST_PROTOCOL_VERSION`](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/mcp/src/protocol/types.ts#L4)).
  - Our prior research records the current MCP revision as `2026-07-28`, a stateless, breaking revision ([ai-skill-formats.md](https://github.com/Hawkeye-Education/HawkeyeHub/blob/research/ai-skill-formats/docs/research/ai-skill-formats.md)). pi-mcp's source cites 2026-07-28 only for `structuredContent` typing.
- **Large tool sets (Pi).** pi-durable has `deferred` tools + `tool_search`, and `codemode` (model-written JS in QuickJS that calls tools) ([durable README L253-272](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/durable/README.md#L253-L272)).
- **LangGraph.** `@langchain/mcp-adapters` "converts MCP tools and results into LangChain formats, ready to use with `createAgent` or a custom LangGraph workflow". It can also "pause an agent when a modern MCP server requests a form response" ([README](https://github.com/langchain-ai/langchainjs/blob/main/libs/langchain-mcp-adapters/README.md)).

### 3.3 Agent Skills (`SKILL.md`, playbooks)

- **Pi.** `pi-coding-agent` "implements the Agent Skills specification". It scans `~/.agents/skills/` and `.agents/skills/` and puts name, description and path in the system prompt. The model reads `SKILL.md` on demand ([skills.md L7, L41-47](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/coding-agent/docs/skills.md#L41-L47)).
  - The loader is exported: `loadSkills`, `loadSkillsFromDir` and `formatSkillsForPrompt` ([index.ts L323-331](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/coding-agent/src/index.ts#L323-L331)).
  - `formatSkillsForPrompt` assumes a `read` or `bash` tool exists to load the file ([skills.ts L358-388](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/coding-agent/src/core/skills.ts#L358-L388)).
  - `pi-agent-core` no longer contains skills: they were removed in 1.0.0 ([CHANGELOG](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/agent/CHANGELOG.md#L27-L31)).
  - In `pi-durable`, skills are an extension that contributes a prompt `section` ([spec L2573](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/durable/docs/spec.md#L2573)).
- **LangGraph.** No skills concept. LangChain's `deepagents` (JS, MIT, 1.15.0) has [`src/skills/loader.ts`](https://github.com/langchain-ai/deepagentsjs/blob/main/libs/deepagents/src/skills/loader.ts) and [`middleware/skills.ts`](https://github.com/langchain-ai/deepagentsjs/blob/main/libs/deepagents/src/middleware/skills.ts).

### 3.4 Interruption and human-in-the-loop

- **pi-agent-core.**
  - `beforeToolCall` runs after argument validation. It is async and can return `{ block: true, reason }`.
  - `afterToolCall` can rewrite results.
  - `steer()` injects a user message after the current tool batch, and `followUp()` queues work. `abort()` cancels.
  - All of this is in-memory: an approval is an awaited promise inside the running loop.
  - The CLI's permission pattern is exactly this: `pi.on("tool_call", …)` with `await ctx.ui.confirm(...)` ([extensions.md L167-175](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/coding-agent/docs/extensions.md#L167-L175)). If the process exits while it waits, nothing about the pending approval is stored.
- **pi-durable.**
  - The `beforeTool` hook can block or rewrite a call ([durable README L510-529](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/durable/README.md#L510-L529)).
  - An inbox handles steers, follow-ups and writes while busy ([L408-425](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/durable/README.md#L408-L425)).
  - Tasks can enter a durable `waiting` state on other tasks ([L587-612](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/durable/README.md#L587-L612)).
  - Grepping the README and the 5.4k-line spec for approval, human and interrupt found only the `{ block: "Needs approval" }` example ([spec L2582-2584](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/durable/docs/spec.md#L2582-L2584)). There is **no documented pause-until-a-human-answers-then-resume primitive**.
- **LangGraph.** `interrupt(value, { responseSchema })` throws `GraphInterrupt`, and the run is resumed with `Command({ resume })`. A checkpointer is mandatory (`MISSING_CHECKPOINTER`), so a pending interrupt survives restarts when a persistent checkpointer is used ([interrupt.ts](https://github.com/langchain-ai/langgraphjs/blob/61807113665e4875c6ec8fd34c6f6c9f7becf497/libs/langgraph-core/src/interrupt.ts#L39-L108)). The `langchain` package adds `humanInTheLoopMiddleware` with decisions `approve | edit | reject | respond` ([hitl.ts](https://github.com/langchain-ai/langchainjs/blob/main/libs/langchain/src/agents/middleware/hitl.ts)).

### 3.5 Persistence, checkpointing, resume

- **pi-agent-core:** none. The 1.0.0 changelog removed "sessions and session storage, the durable runtime … compaction, skills" and directs users to pi-durable. The `prepareRequest` hook can load canonical messages from host storage before every request ([agent README L124-134](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/agent/README.md#L124-L134)).
- **pi-coding-agent SDK:** "Sessions are persistent by default". Storage is a JSONL entry tree with branching and compaction ([sdk.md L38](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/coding-agent/docs/sdk.md#L38)). This is conversation persistence, not mid-tool checkpointing.
- **pi-durable:**
  - "Task: a durable state machine that saves a checkpoint at every step".
  - Tool intent is committed before `execute()`. After a crash, a tool reruns only if it is declared `replay: "safe"`; otherwise the model gets an `interrupted` result ([README L82-92, L181](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/durable/README.md#L82-L92)).
  - `requestId` makes submissions idempotent ([L103-126](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/durable/README.md#L103-L126)).
  - Storage options are memory, **SQLite via Node's built-in `node:sqlite`** ([node.ts L3-4](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/durable/src/storage/sqlite/node.ts#L3-L4)), JSONL, or a Cloudflare Durable Object.
  - "One process owns a storage at a time; there is no cross-process locking" ([L662-688](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/durable/README.md#L662-L688)).
- **LangGraph:** checkpointers are saved per super-step. [`checkpoint-sqlite` depends on `better-sqlite3`](https://github.com/langchain-ai/langgraphjs/blob/61807113665e4875c6ec8fd34c6f6c9f7becf497/libs/checkpoint-sqlite/package.json#L30). The README claims "Durable execution — … automatically resuming from exactly where they left off" ([README L37](https://github.com/langchain-ai/langgraphjs/blob/61807113665e4875c6ec8fd34c6f6c9f7becf497/libs/langgraph-core/README.md#L37)).

### 3.6 Multi-agent

- **Pi core:** no sub-agents, by design ([README L19](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/README.md#L19)). The CLI has an example `subagent` extension (`packages/coding-agent/examples/extensions/subagent`).
- **pi-durable:** subagents are ordinary tools that create task-owned conversations. Child tasks support `allSettled`/`failFast`. `harness.taskGraph()` exposes the live ownership tree ([L540-628](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/durable/README.md#L540-L628)). This is imperative composition. There is no declarative node/edge graph.
- **LangGraph:**
  - `StateGraph` with conditional edges and subgraphs.
  - `createSupervisor` ([supervisor README](https://github.com/langchain-ai/langgraphjs/blob/61807113665e4875c6ec8fd34c6f6c9f7becf497/libs/langgraph-supervisor/README.md)) and swarm handoffs.
  - `createReactAgent`'s params type is deprecated in favour of `createAgent` in the `langchain` package ([react_agent_executor.ts L482-484](https://github.com/langchain-ai/langgraphjs/blob/61807113665e4875c6ec8fd34c6f6c9f7becf497/libs/langgraph-core/src/prebuilt/react_agent_executor.ts#L482-L484)).

### 3.7 Running inside Electron

Our prior research established these baselines ([electron-isolation-primitives.md](https://github.com/Hawkeye-Education/HawkeyeHub/blob/research/electron-isolation-primitives/docs/research/electron-isolation-primitives.md)):

- Electron 44 stable ships Node 24.18.
- Node logic would run in `utilityProcess`.

How each library fits:

- **Node version.** All Pi packages declare `engines.node >= 22.19.0` (e.g. [agent package.json L43-45](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/agent/package.json#L43-L45)). LangGraph declares `>=18`.
- **Module format.**
  - **Pi is ESM-only** (`"type": "module"`, `import`-only exports). LangGraph ships both `import` and `require` exports.
  - Electron supports ESM in the main process from 28.0.0 ([ESM tutorial](https://www.electronjs.org/docs/latest/tutorial/esm)).
  - The [utilityProcess docs](https://www.electronjs.org/docs/latest/api/utility-process) do not mention ESM.
- **SQLite.**
  - pi-durable's SQLite uses built-in `node:sqlite`. Electron had a bug ("No such binding: sqlite", #47671), fixed by [PR #47706](https://github.com/electron/electron/pull/47706), merged 2025-07-15 and backported to 36/37/38.
  - LangGraph's SQLite checkpointer uses `better-sqlite3`, a native addon that is built against a specific runtime ABI.
- **Renderer.**
  - pi-ai "supports browser environments" with explicit keys or an injected `CredentialStore`. It also warns: "Exposing API keys in frontend code is dangerous" ([L1609-1634](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/ai/README.md#L1609-L1634)).
  - The repo runs a `check:browser-smoke` step ([package.json](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/package.json)).
  - LangGraph has a `@langchain/langgraph/web` entry ([web.ts](https://github.com/langchain-ai/langgraphjs/blob/61807113665e4875c6ec8fd34c6f6c9f7becf497/libs/langgraph-core/src/web.ts)).
- **Bundling.** Provider factories import only their own catalog, and the SDKs load lazily with code splitting. `providers/all` is "the heavy, explicit entrypoint". A single-file Node ESM bundle may need a `createRequire` shim ([L1636-1668](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/ai/README.md#L1636-L1668)). pi-durable's root import "costs about 23 MB of peak RSS unbundled, about 4 MB in a tree-shaken bundle" ([L715](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/durable/README.md#L715)).

### 3.8 Dependency weight (measured locally)

I measured these with `npm i --ignore-scripts` into empty directories on Windows, 2026-10-16. The figures are unbundled `node_modules`, so they are an upper bound, not shipped size.

| Install | Packages | `node_modules` | Largest items |
|---|---|---|---|
| `@earendil-works/pi-agent-core@1.3.0` (pulls pi-ai) | 87 | ~90 MB | `openai` 25M, `@anthropic-ai` 13M, `@google` 11M, `web-streams-polyfill` 8.8M, AWS `@smithy` 5.8M |
| + `pi-durable` + `pi-mcp` | 100 | ~102 MB | as above + `@earendil-works` 14M |
| `@langchain/langgraph@1.5.0` + `@langchain/core@1.2.18` + `@langchain/openai` | 25 | ~100 MB | `openai` 30M, `@langchain` 27M, `js-tiktoken` 22M, `langsmith` 14M, `zod` 7.7M |
| `ai@7.0.142` + `@ai-sdk/openai-compatible` (comparison) | 13 | ~25 MB | `ai` 9.6M, `zod` 7.7M |

pi-ai has hard dependencies on every provider SDK, including Bedrock. They are not optional, even when only the `openai-completions` API is used. npm reports these unpacked sizes: pi-ai 4.2 MB, pi-agent-core 0.27 MB, pi-durable 3.2 MB, pi-mcp 0.39 MB, pi-coding-agent 23 MB.

### 3.9 Maintenance and bus factor

**Pi** (gh API, 2026-10-16):

- **Popularity:** 115.6k stars, 14.7k forks, repo created 2025-08-09.
- **Commit activity:** weekly commits over the last 13 weeks were 113, 144, 313, 191, 294, 114, 130, 78, 63, 123, 149, 150, 133. There were ~592 commits since 2026-09-16.
- **Contributors:**
  - All-time: badlogic (Mario Zechner) 3912, mitsuhiko (Armin Ronacher) 897, davidbrai 343, christianklotz 220.
  - The last 300 commits (since 2026-10-01): Zechner 107, Ronacher 103, Brailovsky 59, the rest ≤11.
- **Issues and PRs:** 259 open issues, 81 open PRs, 957 issues closed in the last 30 days.
- **Releases:** 30 releases from v0.80.8 (2026-07-16) to v1.3.0 (2026-10-15).
- **Contribution policy:** "All issues and PRs from new contributors are auto-closed by default" ([CONTRIBUTING.md L25-29](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/CONTRIBUTING.md#L25-L29)).
- **Supply chain:** exact-pinned deps, `min-release-age=2`, and `--ignore-scripts` installs ([README L168-180](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/README.md#L168-L180)).

**LangGraph.js:**

- **Popularity:** 3.4k stars, repo created 2024-01-09.
- **Commit activity:** weekly commits over the last 13 weeks were 14, 5, 11, 8, 16, 8, 9, 22, 4, 16, 7, 28, 26.
- **Contributors (all-time):** dqbd 1096, jacoblee93 290, bracesproul 237, benjamincburns 175, christian-bromann 172.
- **Issues:** 109 open.
- **Releases:** coordinated releases of all `@langchain/langgraph*` packages, the latest on 2026-10-12. Built by LangChain Inc. "but can be used without LangChain" ([README L64](https://github.com/langchain-ai/langgraphjs/blob/61807113665e4875c6ec8fd34c6f6c9f7becf497/libs/langgraph-core/README.md#L64)).

### 3.10 Spec / API stability

**Pi:**

- **Breaking changes after 1.0:** pi-ai's CHANGELOG has "Breaking Changes" sections in **1.0.3, 1.1.0 and 1.3.0** ([CHANGELOG](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/ai/CHANGELOG.md)). Examples:
  - the Azure provider id was renamed
  - stream functions must return `AssistantMessageEventStream`
- **Breaking changes before 1.0:** there were 12 more such sections between 0.75.5 and 0.99.0.
- **pi-agent-core:** had breaking changes in 0.84.0, 0.84.4, 0.87.0 and 1.0.0. In 1.0.0 the whole harness was removed.
- **pi-durable:** is explicitly experimental. Its spec targets a pi-ai PR (#9548) that has not yet landed ([spec L37-39](https://github.com/earendil-works/pi/blob/4dd2b149d155d7369de16ea4dc77c84e9f5ffb24/packages/durable/docs/spec.md#L37-L39)).
- **Renames:** both the npm scope and the GitHub org changed in 2026.

**LangGraph.js:**

- It is on 1.x.
- Prebuilt agent APIs are moving to the `langchain` package. The `createReactAgent` param and state types are marked `@deprecated`.

## 4. Gaps: what Pi lacks that LangGraph gives

| LangGraph capability | `pi-agent-core` | `pi-durable` (experimental) |
|---|---|---|
| Persisted checkpoints per step, resume after crash | No (in-memory; JSON-serializable context only) | **Yes**: per-task-step checkpoints, `resume()`, replay policy |
| Time-travel / fork from past state | No | Fork a conversation at an entry, `rewindable` documents |
| `interrupt()` → persist → resume with a human's answer | No (approval = awaited promise in-process) | **Not documented**: hooks can block, but there is no pause-for-human primitive |
| Declarative graph (nodes, edges, conditional routing, subgraphs) | No | No (imperative task ownership tree) |
| Prebuilt supervisor / swarm multi-agent | No | Subagent-as-tool pattern, child tasks |
| Pluggable checkpoint backends (Postgres/Redis/Mongo) | — | Memory, SQLite, JSONL, Cloudflare DO, custom via conformance suite |

What Pi has that LangGraph core does not: Agent Skills loading (in pi-coding-agent), a dependency-free MCP client, codemode, provider `compat` tuning for OpenAI-compatible servers, and cross-provider handoff with thinking-block handling.

## 5. Hub use cases tested against both

These are the requirements each use case states, as given in the ticket and brief, mapped to the component that provides them. No preference is implied.

**Reference plugin: PDF Watermark Eraser bot.** The bot drafts regex and calls Python tools.

| Need | Pi | LangGraph |
|---|---|---|
| System prompt + model + tool allowlist per bot | `new Agent({ initialState: { systemPrompt, model, tools } })` | `createAgent` / custom graph |
| Python tool (e.g. "test regex on extracted PDF text", "apply erase") | `AgentTool.execute()` spawning bundled Python, or a `uv run` MCP stdio server via `pi-mcp` | `tool()` spawning Python, or `@langchain/mcp-adapters` |
| Iterate draft → test → refine | Built-in tool loop (turns continue while tool calls occur) | ReAct loop / graph cycle |
| User confirms before destructive "apply" | `beforeToolCall` awaiting a renderer IPC reply (in-memory), or the confirm lives in plugin UI outside the agent | `interrupt()` / HITL middleware (needs checkpointer) |
| Survive app restart mid-approval | Not provided by agent-core; pi-durable persists runs but has no documented human-wait primitive | Provided with a persistent checkpointer |
| Stream partial output to UI | `message_update` / `tool_execution_update` events | `stream()` modes |

**Chat-with-tools bot.** Needs a tool loop, streaming and conversation history. agent-core gives the loop and streaming, and messages are plain JSON for host persistence. The coding-agent SDK and pi-durable each also offer session storage. LangGraph gives the same through a checkpointer thread.

**Voice-to-text into a personal KB.**

- The ASR step is outside both. pi-ai's model types are chat, image and classifier; LangGraph has no ASR.
- Any embedding step is outside pi-ai.
- An LLM post-processing step (clean up, title, tag) is a single `complete()` call or a short tool loop in either.

**Does any of these *need* LangGraph's four extras?** The use cases as described do not specify:

- multi-step workflows that must survive an app restart
- approvals that must outlive the process
- multi-agent routing

Whether they will is a product question this research cannot answer.

## 6. Lighter alternatives seen in primary sources (brief)

- **Vercel AI SDK** (`ai` 7.0.142, **Apache-2.0**):
  - Has a `ToolLoopAgent` class (in `ai/dist/index.d.ts`).
  - Tool approval: the per-tool `needsApproval` is marked "@deprecated Tool approval is handled on a `generateText` / `streamText` level now" (`@ai-sdk/provider-utils` types).
  - `@ai-sdk/openai-compatible` covers gateways. Measured ~25 MB / 13 packages.
- **OpenAI Agents SDK JS** (`@openai/agents` 0.20.0, MIT, [repo](https://github.com/openai/openai-agents-js)):
  - Describes itself as "provider-agnostic".
  - Has MCP tools, handoffs and HITL. A tool with `needsApproval` pauses the run, returns `interruptions`, and is approved or rejected on `result.state`. Run state serializes with `toString()`/`fromString()` to resume later ([HITL guide source](https://github.com/openai/openai-agents-js/blob/main/docs/src/content/docs/guides/human-in-the-loop.mdx)).
  - It is pre-1.0 and depends on `openai` + `@openai/agents-realtime`.
- **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk` 0.3.301): it gives "Claude Code's capabilities". Its licence is "SEE LICENSE IN README.md", and the README says use "is governed by Anthropic's Commercial Terms of Service" ([README](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/README.md)), so it is not an OSI licence.

## 7. Open questions only hands-on testing can answer

1. Does `pi-agent-core` (ESM-only) load and run in an Electron 44 `utilityProcess` from both a `.mjs` entry and a CJS entry using dynamic `import()`, packaged with the Hub's bundler (asar, code-split lazy provider chunks)?
2. Does `pi-durable`'s `openNodeSqliteStorage` (`node:sqlite`) work in packaged Electron 44 on Windows and macOS? What is its RSS and startup cost in a `utilityProcess`?
3. Against the company LiteLLM gateway, which `compat` flags does `openai-completions` need (`supportsStore`, `supportsDeveloperRole`, usage-in-streaming, strict tools)? Does tool-call streaming arrive intact through LiteLLM for the target models?
4. With Ollama local models, how reliable is tool calling for the regex-drafting loop (draft → Python test → refine), compared with gateway models?
5. Can a bundler drop the Bedrock/Google/Anthropic SDKs from a pi-ai build that registers only a custom `openai-completions` provider, and what is the resulting bundle size?
6. `pi-mcp` speaks MCP `2025-11-25`. Does it interoperate with a Python MCP server built on the current SDK that targets `2026-07-28`? Is a native `AgentTool` → `child_process` bridge simpler for the bundled uv runtime?
7. Can a pi-durable custom task model "wait for user approval" durably, i.e. park in `waiting` and be resumed by a host-submitted write, without upstream changes?
8. If LangGraph is evaluated: does `better-sqlite3` rebuild cleanly for Electron 44 on both OSes, or does a custom checkpointer over `node:sqlite` work instead?
9. How much churn does Pi's release cadence cause in practice? Measure by pinning 1.3.0 and diffing APIs used across the next few minor releases.
