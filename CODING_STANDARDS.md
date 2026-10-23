# Coding Standards

These rules apply to the Hub, its packages, the Python SDK and every Plugin. Repo layout, versioning and CI are in ADR 0011. Plugin-specific rules are in `PLUGIN_STANDARD.md`. `/code-review` checks every diff against this file.

## Core principle: no leniency

Types describe what the domain actually guarantees. If a value is required, it is required. Missing or malformed data is an error at the boundary, never something the inner code papers over.

## All languages

- **No optional fields by default.** A field is optional only when absence is a real state in the domain, and that is stated in a comment or type name. "Might not be set yet" is a modelling problem, so split the type instead.
- **No default values that hide missing data.** No `?? ""`, `|| 0`, `= ""`, `= None` fallbacks on required inputs. Fail loudly with a clear error.
- **No empty-string, `0`, or `-1` sentinels.** Use a distinct type or a union to represent "none".
- **Validate once, at the trust boundary** (IPC, file input, network, user input, plugin manifest). Parse into a strict type; inside the boundary, trust the type and do not re-validate.
- **No catch-and-swallow.** Handle an error where you can act on it; otherwise let it propagate. Never log-and-continue on data that should have been valid.
- **Constrained strings get their own type** (IDs, paths, locale codes, semver). A bare `string` is not an ID.
- Prefer small deep modules with a narrow interface over wide shallow ones.

## TypeScript

Compiler (non-negotiable, set in the shared `tsconfig`):

- `strict: true`
- `exactOptionalPropertyTypes: true`
- `noUncheckedIndexedAccess: true`
- `noImplicitOverride: true`
- `noFallthroughCasesInSwitch: true`
- `noImplicitReturns: true`
- `noUnusedLocals: true`
- `noUnusedParameters: true`
- `noPropertyAccessFromIndexSignature: true`
- `verbatimModuleSyntax: true`
- `isolatedModules: true`

Rules:

- No `any`. Use `unknown` and narrow it.
- No `as` casts and no non-null `!`, except in tests or with a comment explaining why the type system cannot express it.
- No `?` properties or `| undefined` / `| null` unless absence is a real domain state (see above). Model variants as **discriminated unions**, not bags of optional fields.
- No default parameter values for required domain inputs. Defaults are allowed for genuinely tunable knobs (timeouts, page size) and must be named constants.
- Exhaustive `switch` over unions, with a `never` check in the default branch.
- Parse untrusted data with a zod schema at the boundary; infer the type from the schema. A JSON Schema someone else consumes (such as `manifest.schema.json`) is generated from the zod schema, never written by hand, and CI fails if the checked-in copy is stale.
- Plugin UIs are TypeScript too, built by Vite from `ui-src/` into `ui/`. No hand-written JS ships.
- Lint with ESLint (flat config, `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked`), one shared config at the repo root; format with Prettier. Enforce `no-explicit-any`, `no-non-null-assertion`, `no-unnecessary-condition`, `strict-boolean-expressions`, `switch-exhaustiveness-check`, `no-floating-promises`.

## Python (SDK and Backends)

- Python is managed with `uv`; never rely on a system Python.
- Full type annotations on every function signature, including return types. pyright in strict mode must pass; no mypy.
- `ruff` for lint and format, one shared config at the repo root.
- No `Optional[...]` / `X | None` parameters or fields unless absence is a real domain state. No mutable or "convenient" default arguments that mask missing input.
- Use frozen `dataclass` / pydantic v2 models for structured data; no loose `dict[str, Any]` crossing a function boundary.
- Validate at the boundary (manifest, IPC message, file contents), then pass typed objects inward. A Backend request handler takes one frozen pydantic model, and the SDK validates `params` against it.
- Each `backend/` is a standalone uv project with its own `uv.lock`, not a uv-workspace member.
- No bare `except:` and no `except Exception: pass`.

## Tests

- Test behaviour through the public interface, not internals (see `/tdd`).
- A bug fix lands with a regression test that fails without the fix.
- Tooling: Vitest for TS (Plugin UIs run under happy-dom against `@hawkeye-hub/fake-hub`), pytest for Python (Backends through `hawkeye_hub.testing`, which drives the Backend over real stdio), and a small Playwright `_electron` smoke suite for the Hub end to end.
- A smoke test proves wiring only Electron or a real process can show: IPC, a window, a renderer, a process tree. Each branch of the logic behind it is a Vitest test of its module, not another smoke test. Wait out a real timeout in one smoke test at most; its timing belongs on fake time.
- The Hub's suite covers the Hub API, the Backend bridge, the Python SDK, the Hub Kit, and install and update.
- Every part a Plugin has (Plugin UI, Backend) has at least one test. Publishing runs them and refuses on failure. There is no coverage threshold.

## Toolchain

- pnpm workspaces; no Turborepo or Nx. The Hub is built with electron-vite and packaged with electron-builder.
- Node is pinned in `.node-version` and `engines`, pnpm in `packageManager` (corepack), and uv in `required-version`, set to the version the Hub downloads.

## Git

- Each spec builds on its own `spec/<area>` branch, not `main`. Work each ticket on an `impl/<slug>` branch cut from that spec branch, and open its PR against the spec branch. PRs merge with a merge commit, and CI must be green.
- A PR into a spec branch closes no issues: close them by hand after the merge (`docs/agents/issue-tracker.md`).
- Commit subjects are plain imperative sentences ("Add …", "Fix …"), not Conventional Commits. Releases come from tags (`hub@`, `plugin/<id>@`, `sdk-py@`), not from commit messages.

## Review

Anything that adds an optional field, a default value, a cast, or a swallowed error needs a one-line justification in the code or the PR. No justification, no merge. A justification that rests on how a library or the runtime behaves names how that was checked: a test, a probe run, or a docs link.
