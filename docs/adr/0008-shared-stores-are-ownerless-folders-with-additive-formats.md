# Shared Stores are ownerless folders with additive-only formats

All Hub and Plugin data stays on the machine, belongs to the OS user (not to a **Staff Identity**), and is never synced. A Plugin's private **Plugin Data** is native storage: its Plugin UI uses web storage in a persistent partition named by Plugin id, and its Backend gets one private folder path at start. A **Shared Store** is how two Plugins work on the same data: a named folder in the per-user app data folder, with a flat company-wide name (`kb`, `receipts`), created when the first installed Plugin declares it in its manifest (`stores: [...]`). Declaring a store grants read and write with no staff prompt. No Plugin owns a store, and any declaring Plugin may write it. Backends get the store's path and use plain file I/O. Plugin UIs, which have no filesystem access, get list, read, write and watch calls through the Hub API.

We chose folders over a Hub-run record database (JSON collections with query and subscribe) because the known cases, a Markdown knowledge base and extracted receipts feeding Invoice Exporter, are naturally files. A Backend has no Hub API (ADRs 0003, 0007), so folders reach it with no new channel, and the Hub API gains file calls rather than a query language to freeze. We chose any-writer over a single owner per store so that Plugins can co-operate on a store without routing writes through whichever Plugin happened to create it. The cost is that no Plugin can migrate a store, so each store's format is a document in the repo and changes only additively: new files or fields are fine, renaming or removing is not, and a breaking change means a new store name (`kb-2`) that Plugins move to when ready.

## Consequences

- Writes replace a file atomically (temp file, then rename) and the last writer wins; there are no locks. Data that must merge is laid out one item per file. The Hub API's write does this for Plugin UIs; the authoring guide asks the same of Backends.
- A declared store whose other users aren't installed is simply empty; it never blocks an install.
- Uninstall with "also delete my data" removes the Plugin Data folder, the Plugin UI's partition, the Hub's per-Plugin settings, and every Shared Store the Plugin was the last installed declarer of. "Keep data" keeps all of it. Files written to folders staff chose are never touched.
- Plugins migrate their own Plugin Data forward only, at open; the Hub runs no migrations. There is no rollback (ADR 0005), so no Plugin meets data from a newer version of itself.
- The Hub runs as a single instance per OS user, and each Plugin is open at most once, so Plugin Data never has concurrent writers.
- The Hub's own records are JSON files in app data, with secrets encrypted by `safeStorage`. Assistant conversations are not stored. Plugins keep secrets as encrypted Plugin Data (ADR 0013).
- If two Plugins ever need queries or merge-safe records, a record store can be added beside folders as a new Hub API version.
