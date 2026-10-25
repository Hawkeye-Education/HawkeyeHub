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

**Plugin UI**:
The screen a Plugin shows staff while it is open; every Plugin has exactly one.
_Avoid_: Frontend, view, window

**Backend**:
The optional part of a Plugin that runs as its own process to do work its Plugin UI cannot; a Plugin has at most one.
_Avoid_: Sidecar, server, worker, service

**Busy**:
A state an open Plugin declares while closing it would lose work in progress; the Hub asks staff before closing a Busy Plugin.
_Avoid_: Locked, working, in use

**Plugin Data**:
What a Plugin keeps on the machine between opens, private to that Plugin and belonging to the OS user rather than to a Staff Identity; it never leaves the machine.
_Avoid_: Plugin storage, app data, state

**Shared Store**:
A named folder of files the Hub keeps so that every Plugin declaring it can read and write the same data; owned by no Plugin, belonging to the OS user, and never leaving the machine.
_Avoid_: Shared storage, common folder, data bus

**Supported Platforms**:
The operating system and processor combinations a Plugin declares it runs on; the Hub only installs a Plugin on a machine that matches one.
_Avoid_: Targets, OS list

**Hub API**:
The versioned contract the Hub offers Plugins; each Plugin declares which Hub API versions it works with, independent of the Hub's own version.
_Avoid_: SDK version, Hub version

**Manifest**:
The `manifest.json` at the root of every Plugin, stating who the Plugin is and which parts it has; every field is required, and a part the Plugin lacks is stated, never omitted.
_Avoid_: Plugin config, package.json, descriptor

**Diagnostics Bundle**:
The zip of the Hub's and every Plugin's logs, plus a description of the installation, that staff export themselves and send to whoever maintains the Hub; nothing else ever takes diagnostics off the machine.
_Avoid_: Crash report, log dump, support bundle, telemetry

### Look and feel

**Hub Chrome**:
Everything the Hub draws around the Plugin UIs, such as the Plugin Switcher, the Assistant Panel, dialogs and settings; Plugins never add to it.
_Avoid_: Shell UI, frame, toolbar

**Plugin Switcher**:
The part of the Hub Chrome that shows every installed Plugin and from which staff open, switch between and close them.
_Avoid_: Launcher, dock, tab bar, home screen

**Favourite**:
An installed Plugin a staff member has starred so the Plugin Switcher shows it in its own section above the rest; belongs to the OS user, like Hub Settings, and never leaves the machine.
_Avoid_: Pinned, bookmark, shortcut

**Hub Kit**:
The shared set of ready-styled interface pieces the Hub provides to every Plugin UI and builds its own Hub Chrome from; Plugins compose their screens from it rather than styling their own.
_Avoid_: Component library, design system, widgets

**Theme**:
A named look for the whole Hub, such as Hawkeye, chosen company-wide with a per-installation override and never chosen by a Plugin.
_Avoid_: Skin, style, brand

**Colour Scheme**:
Whether the Hub shows its Theme light or dark, or follows the operating system; separate from the Theme.
_Avoid_: Dark mode, appearance, theme

**Display Language**:
The language the Hub shows staff, chosen per installation and following the operating system by default; a Plugin shows it where it has a translation and English otherwise.
_Avoid_: Locale, UI language

### Distribution

**Registry**:
The one company-wide place the Hub learns which Plugins and Hub versions exist and downloads them from.
_Avoid_: Store, marketplace, repository

**Plugin Package**:
One published version of a Plugin as a single downloadable file, the same for every Supported Platform.
_Avoid_: Bundle, build, release

**Plugin Catalogue**:
The Hub Chrome screen listing every Plugin the Registry offers, from which staff install and uninstall Plugins and see why one cannot be installed.
_Avoid_: Store, marketplace, app list

**Company Configuration**:
The company-wide settings every Hub installation shares, such as its Auth Provider, Role Mapping and Sign-in Lifetime; it holds no secrets.
_Avoid_: Hub config, settings, tenant config

**Hub Settings**:
The choices staff make on one Hub installation, such as Theme, Colour Scheme and Display Language; they belong to the OS user rather than to a Staff Identity, never leave the machine, and override the Company Configuration where both apply.
_Avoid_: Preferences, options, config

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

**Assistant Panel**:
The chat panel the Hub draws beside a Plugin UI for that plugin's Assistant; plugins configure it but never draw it.
_Avoid_: Chat window, bot UI, sidebar

**Playbook**:
The set of Skills a plugin ships for its Assistant to draw on; written by the plugin's developers and read-only to staff.
_Avoid_: Knowledge base, resources, prompt pack

**Skill**:
One topic of a Playbook, such as how to write a watermark regex, with its supporting reference documents.
_Avoid_: Prompt, recipe, tool

**Prompt Template**:
A ready-made message a plugin offers in its Assistant Panel that staff pick, edit and send themselves.
_Avoid_: Preset, quick action, slash command

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
