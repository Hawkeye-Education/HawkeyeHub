# Coding Standards

Seed standards. Ticket #14 (monorepo structure and coding standards) will refine and extend this file; until then these rules apply. `/code-review` checks every diff against this file.

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

Rules:

- No `any`. Use `unknown` and narrow it.
- No `as` casts and no non-null `!`, except in tests or with a comment explaining why the type system cannot express it.
- No `?` properties or `| undefined` / `| null` unless absence is a real domain state (see above). Model variants as **discriminated unions**, not bags of optional fields.
- No default parameter values for required domain inputs. Defaults are allowed for genuinely tunable knobs (timeouts, page size) and must be named constants.
- Exhaustive `switch` over unions, with a `never` check in the default branch.
- Parse untrusted data with a schema (e.g. zod) at the boundary; infer the type from the schema.
- Lint (ESLint, `typescript-eslint` strict + stylistic): enforce `no-explicit-any`, `no-non-null-assertion`, `no-unnecessary-condition`, `strict-boolean-expressions`, `switch-exhaustiveness-check`, `no-floating-promises`.

## Python (plugins)

- Python is managed with `uv`; never rely on a system Python.
- Full type annotations on every function signature, including return types. `mypy --strict` (or pyright strict) must pass.
- `ruff` for lint and format.
- No `Optional[...]` / `X | None` parameters or fields unless absence is a real domain state. No mutable or "convenient" default arguments that mask missing input.
- Use frozen `dataclass` / `pydantic` models for structured data; no loose `dict[str, Any]` crossing a function boundary.
- Validate at the boundary (manifest, IPC message, file contents), then pass typed objects inward.
- No bare `except:` and no `except Exception: pass`.

## Tests

- Test behaviour through the public interface, not internals (see `/tdd`).
- A bug fix lands with a regression test that fails without the fix.

## Review

Anything that adds an optional field, a default value, a cast, or a swallowed error needs a one-line justification in the code or the PR. No justification, no merge.
