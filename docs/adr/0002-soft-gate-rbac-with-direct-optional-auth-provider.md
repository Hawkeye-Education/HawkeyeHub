# Soft-gate RBAC with a direct, optional Auth Provider and no auth backend

The Hub signs staff in by talking straight to one **Auth Provider** — LDAP (Hub form, LDAPS bind and group lookup from the desktop) or OAuth2/OIDC (system browser, loopback redirect, PKCE) — with no Hub backend in between. A company's Hub configuration has exactly one Auth Provider or none: none is a real deployment state (no directory exists yet), and then there is no sign-in and no **Staff Identity**. **Roles** come from directory groups through a company-wide **Role Mapping**; plugin manifests name only Roles. The Hub enforces Roles itself at install and at every open, so entitlements are a soft gate: they decide what staff see and run, not what code can reach their disk. Anything genuinely sensitive is protected at its data source.

We chose this over a small auth backend that would broker LDAP and OAuth2, hold Hub-owned Role assignments and could hard-gate plugin downloads. Nothing else on the map needs a server (AI Providers already connect directly), and a soft gate needs no server-side check. The cost: every desktop must reach the directory (office network or VPN), Role revocation lags by up to one **Sign-in Lifetime**, and a determined staff member can copy a gated plugin from a colleague. Making the Auth Provider optional lets the Hub ship before a directory exists; the absence is contained by plugins declaring whether they need identity, so a plugin that does is never opened without one.

## Consequences

- Plugins declare whether they need identity (declaring Roles implies it). Without an Auth Provider, those plugins cannot be installed or opened; the rest work unchanged. Plugins that need identity always receive one; plugins that don't never receive one.
- The cached Staff Identity is stored with `safeStorage` per OS user. OIDC renews it silently when reachable; LDAP never stores the password, so it re-prompts once the Sign-in Lifetime runs out. Sign-in Lifetime is a required configuration field.
- Losing a Role leaves the plugin installed but unopenable; its data is untouched.
- If direct LDAP from desktops becomes painful, Keycloak can front the directory and the Hub switches to its OIDC kind without plugins noticing. Keycloak (federating an LDAP directory) is also the development target that exercises both kinds.
- Per-user OAuth2 access to third-party services for plugins (Service Connections) is separate from sign-in and not decided here.
- A hard gate stays possible later if the plugin registry checks identity before serving a package.
