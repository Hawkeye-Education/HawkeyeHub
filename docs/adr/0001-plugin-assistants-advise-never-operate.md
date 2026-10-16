# Plugin Assistants advise; they never operate the plugin

A plugin's AI is an **Assistant** to the human using the plugin, not an agent acting on their behalf. It answers questions about the plugin and produces output the human copies in themselves, such as a regex for the PDF Watermark Eraser. Its only knowledge is its plugin's playbook and whatever the human hands it in the conversation. It calls no tools: it cannot run the plugin, read or write the user's files, change settings, or test its own output. This holds for every plugin.

We chose this over letting Assistants operate plugin tools (agentic, à la Claude Code plugins / MCP), and over a middle ground of read-only "inspect and simulate" tools (e.g. test a regex against page text). Keeping a human between the model and every action removes the need for tool permissions, approval flows and an agent harness, and keeps a wrong answer cheap. The cost is that Assistant output is untested, so a bad regex surfaces only when the human tries it.

## Consequences

- The Hub's AI layer is chat with resources attached; no tool-execution loop, no durable human-in-the-loop, no graph orchestration (see the Pi vs LangGraph research, issue #15).
- Revisiting read-only inspection tools later would be additive: a plugin would declare tools the Hub verifies are side-effect free.
