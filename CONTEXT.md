# HawkeyeHub

An internal desktop hub for Hawkeye Education staff that hosts small installable mini-programs, loading each only while it is open.

## Language

### Hub and plugins

**Hub**:
The desktop application staff install; it hosts plugins and owns shared services such as AI access.
_Avoid_: Shell, launcher, host app

**Plugin**:
An installable mini-program that runs inside the Hub.
_Avoid_: Mini-program, app, extension

### AI

**AI Provider**:
A connection to one AI service (its kind, key and endpoint) configured separately on each Hub installation and owned solely by the Hub; plugins use AI only through the Hub and never see the key.
_Avoid_: Model, backend, gateway

**Default AI Provider**:
The AI Provider and model a Hub installation uses for any plugin that does not choose one itself.
_Avoid_: Primary provider, fallback provider

**Assistant**:
A plugin's AI helper that advises the human using that plugin and never operates the plugin itself.
_Avoid_: Bot, agent, copilot

**Playbook**:
The set of documents a plugin ships for its Assistant to draw on.
_Avoid_: Knowledge base, resources, prompt pack

### Identity

**Auth Provider**:
The one directory or identity service (LDAP or OAuth2/OIDC) a company's Hub configuration uses to sign staff in; a configuration has exactly one or none.
_Avoid_: IdP, login server, auth backend

**Staff Identity**:
Who the signed-in staff member is — a stable id, name, email and Roles — as proven by the Auth Provider; never includes a credential.
_Avoid_: User, account, session

**Role**:
A Hub-level name a plugin can require before it may be installed or opened.
_Avoid_: Group, permission, entitlement

**Role Mapping**:
The company-wide rule set that turns an Auth Provider's directory groups into Roles.
_Avoid_: Group mapping, ACL

**Sign-in Lifetime**:
How long a Staff Identity stays usable after it was last proven, including while the Auth Provider is unreachable.
_Avoid_: Session timeout, grace period
