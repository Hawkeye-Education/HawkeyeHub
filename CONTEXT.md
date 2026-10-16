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
