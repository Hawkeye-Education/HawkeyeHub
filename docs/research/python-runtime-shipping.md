# Research: Shipping Python plugins on Windows + macOS without a system Python

Resolves #3. Researched 2026-10-16. **Facts and trade-offs only. No decision is made here.** This feeds the runtime-model and distribution tickets.

**Question:** What are the viable ways to ship Python-based plugins (PyMuPDF, opencv-python, Playwright + a browser, Flask) to Windows and macOS (Apple Silicon and possibly Intel) staff machines that have no system Python, when plugins are installed on demand from a private registry?

**Options compared:** python-build-standalone (PBS) + `uv`, PyInstaller, Nuitka, and the python.org embeddable package.

Facts marked **[measured]** were checked on a Windows 10 x64 machine on 2026-10-16. Facts marked **[PyPI]** / **[GitHub API]** come from the PyPI JSON API and GitHub releases API on the same date. Everything else cites its source.

---

## TL;DR

- **Only two options give you a reusable runtime: PBS (on both OSes) and the embeddable package (Windows only).** PyInstaller and Nuitka freeze each app with its own interpreter. That means a *per-plugin bundle* model, built in CI per OS/arch, with no cross-compiling.
- **PBS + uv is the only option that covers all four targets with one model:** Windows x64/arm64 and macOS arm64/x86_64, using PyPI wheels as-is. PBS releases are **not code-signed**. The Windows `python.exe` is not Authenticode-signed **[measured]**, and on x86_64 macOS the binaries carry no ad-hoc signature by default.
- **Every native wheel needed has binaries for win_amd64, macOS arm64 and macOS x86_64.** But opencv-python 5.x needs **macOS 14+ on Intel** and **13+ on Apple Silicon**, and has **no win_arm64 wheel** **[PyPI]**.
- **macOS Gatekeeper/notarization is driven by the quarantine attribute.** Apple says apps can load *quarantined* plug-ins only if they are notarized. For network installers, Apple says to "separately notarize both the installer and the items it downloads." Whether files the Hub downloads get quarantined depends on how they are written. Files written by plain Node `fs` are not quarantined by default (see §5).
- **If the Hub signs the Python interpreter with hardened runtime, library validation applies to it.** Library validation blocks loading `.so`/`.dylib` files not signed by Apple or the same Team ID. That covers essentially every PyPI wheel. The workarounds are to re-sign every wheel binary with the Hub's Team ID, or to add `com.apple.security.cs.disable-library-validation`, which triggers extra Gatekeeper checks.
- **SmartScreen:** EV certificates **no longer bypass SmartScreen** (Microsoft, 2026). Reputation builds per hash or certificate over weeks. **Smart App Control** on Windows 11 blocks unsigned, unknown binaries regardless of how they arrived. PyInstaller's own docs say pre-built bootloaders cause AV false positives.

---

## 1. Option-by-option

### 1.1 python-build-standalone (PBS) + uv

**What it is.** Redistributable, relocatable CPython builds, now hosted by Astral at `github.com/astral-sh/python-build-standalone`. `uv` uses them for its managed Python installs. ([PBS running docs](https://gregoryszorc.com/docs/python-build-standalone/main/running.html), [uv Python versions](https://docs.astral.sh/uv/concepts/python-versions/))

**Targets.** `aarch64-apple-darwin`, `x86_64-apple-darwin`, `x86_64-pc-windows-msvc`, `aarch64-pc-windows-msvc` (3.11+). Flavours are `install_only`, `install_only_stripped` and `full`. ([running docs](https://gregoryszorc.com/docs/python-build-standalone/main/running.html)) There is no `universal2` macOS build, so you ship one archive per arch.

**Sizes** (release `20261013`, CPython 3.13.16) **[GitHub API]**:

| Target | install_only | install_only_stripped |
|---|---|---|
| macOS arm64 | 25.4 MB | 25.3 MB |
| macOS x86_64 | 25.1 MB | 25.0 MB |
| Windows x64 | 47.5 MB | 22.0 MB |
| Windows arm64 | 44.5 MB | 21.0 MB |

Windows x64 stripped extracts to **59.7 MB** on disk **[measured]**.

**uv.** It is a single binary: `uv.exe` 0.13.1 for Windows x64 is **30.6 MB** and **is Authenticode-signed** (signer `CN="OpenAI OpCo, LLC"`) **[measured]**. The Hub can point everything at Hub-controlled locations and a private mirror with these settings ([uv env reference](https://docs.astral.sh/uv/reference/environment/)):
- `UV_PYTHON_INSTALL_DIR`
- `UV_CACHE_DIR`
- `UV_PYTHON_INSTALL_MIRROR` / `UV_PYTHON_DOWNLOADS_JSON_URL` (mirror PBS)
- `UV_DEFAULT_INDEX` / `UV_INDEX` / `UV_FIND_LINKS` (private wheel index)
- `UV_OFFLINE`
- `UV_PYTHON_DOWNLOADS`, `UV_MANAGED_PYTHON`

**Shared runtime vs per-plugin.** One PBS interpreter can back a separate venv per plugin. uv installs from a global cache into each env by **hardlink on Windows and clone (copy-on-write) on macOS** ([uv settings: link-mode](https://docs.astral.sh/uv/reference/settings/)). Two plugins that both depend on numpy therefore don't double the disk use, as long as the cache is on the same filesystem as the envs ([uv cache docs](https://docs.astral.sh/uv/concepts/cache/)). Existing envs keep pointing at the old interpreter path if it moves ([uv storage](https://docs.astral.sh/uv/reference/storage/)).

**Quirks** ([PBS quirks](https://gregoryszorc.com/docs/python-build-standalone/main/quirks.html)):
- No `pip.exe` on Windows. Use `python -m pip` or uv.
- Build-time absolute paths remain in sysconfig. uv fixes them up, so "this quirk generally does not affect uv users".
- Tix is not shipped.

**Signing.** PBS release binaries are unsigned:
- Windows `python.exe` and `python313.dll` show `NotSigned` **[measured]**.
- The maintainer's original stance was that distributions would be "signed as part of that larger application". The request for signed releases is still open: [PBS #89](https://github.com/astral-sh/python-build-standalone/issues/89).
- On macOS, x86_64 binaries had no ad-hoc signature, because the toolchain only ad-hoc signs by default when targeting arm64. Releases from `20250902` added headerpad so downstream re-signing works ([PBS #749](https://github.com/astral-sh/python-build-standalone/issues/749)). **Re-signing PBS with your own Developer ID is a documented, supported path.**

**Windows AV latency.** Antivirus scanning of unsigned or modified `.exe` files can add about 0.5 s per launch of venv launcher executables ([uv #10288](https://github.com/astral-sh/uv/issues/10288), open).

### 1.2 PyInstaller

- **Model:** It freezes the script plus its own interpreter copy. "The output of PyInstaller is specific to the active operating system and the active version of Python". It can't cross-build, so you need a CI runner per OS/arch. Bundles don't share anything ([operating mode](https://pyinstaller.org/en/stable/operating-mode.html)). **Each plugin is a full bundle with its own interpreter.**
- **onefile vs onedir:**
  - onefile extracts to `_MEIxxxxxx` in temp on every launch, which makes it slower to start. The folder is left behind if the process crashes. The docs say "running multiple copies is expensive in disk space because nothing is shared".
  - onedir avoids extraction.
  - The docs warn against running onefile executables as admin on Windows ([operating mode](https://pyinstaller.org/en/stable/operating-mode.html)).
- **macOS arch** ([feature notes](https://pyinstaller.org/en/stable/feature-notes.html)):
  - By default it builds for the current arch only. `--target-arch universal2` needs a universal2 Python *and* universal2 wheels for every native dependency.
  - Lipo-merging two single-arch builds is not supported.
  - opencv-python and PyMuPDF publish no universal2 wheels **[PyPI]**, so a realistic setup is separate arm64 and x86_64 builds.
- **macOS signing:** It ad-hoc signs everything by default. `--codesign-identity` and `--osx-entitlements-file` let you sign with a real Developer ID and hardened runtime. The docs don't cover notarization ([feature notes](https://pyinstaller.org/en/stable/feature-notes.html)).
- **Windows AV:** PyInstaller's own docs list avoiding "anti-virus false positives that result from the wide-spread use of pre-compiled bootloaders" as a reason to rebuild the bootloader ([bootloader building](https://pyinstaller.org/en/stable/bootloader-building.html)). Community reports also name UPX, missing version info and no signature as contributing factors, e.g. Defender's `Trojan:Win32/Bearfoos.B!ml` ML detection ([microsoft/apm#487](https://github.com/microsoft/apm/issues/487); secondary).
- **Playwright:** Playwright documents `PLAYWRIGHT_BROWSERS_PATH=0 playwright install chromium` followed by `pyinstaller -F main.py` to bundle a browser into the exe. It notes this "will generate bigger binaries" ([Playwright library docs](https://playwright.dev/python/docs/library)).

### 1.3 Nuitka

Source: [user manual](https://nuitka.net/user-documentation/user-manual.html) and the [option definitions in source](https://github.com/Nuitka/Nuitka/blob/main/nuitka/options/OptionParsing.py).

- **Model:** It compiles Python to C and needs a C compiler on the build machine:
  - On Windows that is MSVC, or MinGW64. MinGW64 must be the one Nuitka downloads, and it doesn't support Python ≥ 3.13 without `--experimental=force-mingw64`.
  - Clang and Zig are also options.

  Modes include `standalone`, `onefile` and `app`. Like PyInstaller, it produces **a per-plugin bundle with its own interpreter**.
- **onefile:** It unpacks to `{TEMP}/onefile_{PID}_…` by default. `--onefile-tempdir-spec` can point to a static cache dir that is reused between runs, and `--onefile-cache-mode=cached` keeps it.
- **macOS:**
  - `--macos-target-arch` accepts only `arm64` or `x86_64`, limited to what the running Python allows. There is no universal option in the CLI.
  - "The signing of code is now mandatory on macOS and cannot be disabled". The default is ad-hoc.
  - `--macos-sign-identity` plus `--macos-sign-notarization` add the hardened-runtime option needed for notarization.
- **Playwright:** A built-in `playwright` plugin can bundle installed browsers via `--playwright-include-browser` ([PlaywrightPlugin.py](https://github.com/Nuitka/Nuitka/blob/main/nuitka/plugins/standard/PlaywrightPlugin.py)). There is also a built-in numpy plugin.
- **Windows AV:** Nuitka's docs say nothing official about false positives. Community reports show Nuitka builds also get flagged ([umo#49](https://gitlab.com/modding-openmw/umo/-/issues/49); secondary). Vendor claims that Nuitka avoids AV flags come from parties selling Nuitka-based tooling, so treat them as unverified.

### 1.4 python.org embeddable package

- **Windows only.** The python.org macOS docs offer only a system-wide signed and notarized `.pkg` (universal2 framework build, admin rights needed). There is no embeddable or redistributable macOS artifact ([Using Python on macOS](https://docs.python.org/3/using/mac.html)).
- **What it is:** A ZIP with a minimal runtime, "intended for acting as part of another application". It is "(almost) fully isolated" from the registry and environment. It omits Tcl/tk, pip and docs. A `._pth` file restricts `sys.path`, and `site` is disabled unless uncommented. The docs say "Using pip to manage dependencies … is not supported"; dependencies should be vendored by the installer ([Using Python on Windows §4.2](https://docs.python.org/3/using/windows.html)).
- **Size:** 3.14.8 amd64 is a 12.6 MB zip that extracts to 23.3 MB **[measured]**.
- **Signing:** **`python.exe` and `python314.dll` are Authenticode-signed by the Python Software Foundation [measured].** That is the main practical advantage over PBS on Windows.
- **macOS equivalent (third-party):** BeeWare's [Python-Apple-support](https://github.com/beeware/Python-Apple-support) publishes a `macOS-support` embeddable framework. The latest release is `3.15-b1`, dated 2026-10-12 **[GitHub API]**. It is used by Briefcase, which "supports … managing signing and notarization" ([macOS docs §5.5.3](https://docs.python.org/3/using/mac.html)).

---

## 2. Native wheel availability (latest on PyPI, 2026-10-16) **[PyPI]**

| Package (version) | win_amd64 | win_arm64 | macOS arm64 | macOS x86_64 | Notes |
|---|---|---|---|---|---|
| PyMuPDF 1.28.2 | ✅ 19.8 MB | ✅ | ✅ 11.0+, 23.9 MB | ✅ 10.15+, 24.6 MB | `abi3` (cp310+), so one wheel covers all Python ≥ 3.10 |
| opencv-python 5.0.0.93 | ✅ 44.0 MB | ❌ | ✅ **13.0+**, 48.3 MB | ✅ **14.0+**, 34.8 MB | `abi3`; requires numpy ≥ 2. A `-headless` variant has the same platforms |
| numpy 2.5.4 | ✅ ~12.7 MB | ✅ | ✅ 11.0+ / 14.0+ | ✅ 10.13+ / 14.0+ | Per-CPython-version wheels (cp312–cp315). requires_python ≥ 3.12 |
| playwright 1.64.0 | ✅ 38.7 MB | ✅ 34.6 MB | ✅ 11.0+, 43.0 MB | ✅ 10.13+, 44.3 MB | `py3-none` platform wheels that bundle the driver; also universal2. Needs greenlet (cp-specific, universal2 on macOS) |
| Flask 3.1.3 | pure Python, 0.1 MB | | | | No native deps |

**Implications (facts):**
- The opencv-python Intel-Mac wheel requires **macOS 14 Sonoma or later**. Older Intel Macs would need an older opencv-python release or a source build.
- No win_arm64 opencv wheel exists. PBS does ship a Windows arm64 interpreter.
- numpy 2.5 requires Python ≥ 3.12, which sets a floor on the runtime version.

**Playwright browsers:**
- `playwright install` downloads browsers to `%USERPROFILE%\AppData\Local\ms-playwright` on Windows and `~/Library/Caches/ms-playwright` on macOS.
- They take "a few hundred megabytes". The doc's macOS example shows Chromium at 281 MB.
- `PLAYWRIGHT_BROWSERS_PATH` sets a shared location. `PLAYWRIGHT_DOWNLOAD_HOST` points downloads at an internal mirror.
- Unused versions are garbage-collected; `PLAYWRIGHT_SKIP_BROWSER_GC=1` disables that.
- `--only-shell` downloads only the headless shell.
- `channel="msedge"` / `"chrome"` drives an **already-installed branded browser** instead of downloading one.

([Playwright browsers](https://playwright.dev/python/docs/browsers))

---

## 3. Comparison matrix

| | PBS + uv | PyInstaller | Nuitka | Embeddable (python.org) |
|---|---|---|---|---|
| Windows x64 / arm64 | ✅ / ✅ | ✅ / build on arm64 | ✅ / build on arm64 | ✅ / ✅ (arm64 zip exists) |
| macOS arm64 / x86_64 | ✅ / ✅ (separate archives) | ✅ / ✅ (per-arch build; universal2 needs universal2 wheels) | ✅ / ✅ (per-arch, no universal) | ❌ (BeeWare framework is the macOS analogue) |
| Shared runtime across plugins | ✅ one interpreter, per-plugin venvs, deps deduped via hardlink/clone | ❌ interpreter per bundle | ❌ interpreter per bundle | ✅ possible, but deps must be vendored manually (no pip) |
| Uses PyPI wheels unchanged | ✅ | ✅ (frozen in) | ✅ (compiled/bundled) | ✅ (vendored into a dir on `._pth`) |
| Build infra | none per plugin; just a lockfile | CI runner per OS/arch | CI runner per OS/arch + C compiler | CI per OS/arch to vendor wheels |
| Base runtime size | ~22–25 MB download, ~60 MB on disk (Win) + uv 31 MB | not stated in docs; scales with deps × per plugin | not stated in docs; scales with deps × per plugin | 12.6 MB zip, 23 MB on disk |
| Windows signature out of the box | ❌ python.exe unsigned (uv.exe signed) | ❌ (you sign) | ❌ (you sign) | ✅ PSF-signed |
| macOS signing out of the box | ad-hoc on arm64 only; re-signable | ad-hoc; Developer ID via flag | ad-hoc mandatory; Developer ID + notarization flag | n/a |
| Known AV false-positive issue | AV scan latency on unsigned launchers (uv #10288) | documented by PyInstaller (pre-built bootloader) | community reports | none found |

Per-plugin disk cost of a frozen bundle is roughly the interpreter plus the plugin's wheels unpacked. Wheel sizes are compressed, so unpacked is larger. As a lower bound: an opencv plugin is ≥ 44 MB of opencv wheel plus 5–17 MB of numpy, before the interpreter. A Playwright plugin is 35–44 MB of wheel plus a ~281 MB browser if bundled. *(Derived from the figures above, not measured as installed bundles.)*

---

## 4. Windows: SmartScreen, Smart App Control, Defender

- **SmartScreen** looks at publisher reputation and file-hash reputation. "Even when signed, a newly created binary could still show a SmartScreen warning". Reputation "can take several weeks and hundreds of clean installs". Unsigned files restart from zero on every version ([Microsoft: SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation), updated 2026-08).
- **"EV certificates no longer bypass SmartScreen."** Microsoft's recommended option outside the Store is **Artifact Signing** (formerly Trusted Signing), from $9.99/month, with no hardware token (same source). Electron's docs also point to Azure Artifact Signing ([Electron code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)).
- **Enterprise path:** IT admins "may optionally submit files for review via the Microsoft Security Intelligence portal". Enterprises "may distribute files from Trusted Intranet locations not subject to SmartScreen review" (same source).
- **Mark of the Web.** SmartScreen's download check is keyed on the Zone.Identifier ADS that browsers and mail clients write ([Outflank](https://outflank.nl/blog/2020/03/30/mark-of-the-web-from-a-red-teams-perspective/), [Eric Lawrence](https://textslashplain.com/2016/04/04/downloads-and-the-mark-of-the-web/); both secondary but authoritative). Files a Hub process writes itself with Node `fs` carry no MOTW unless the Hub adds it.
- **Smart App Control** (Windows 11) is the exception to the MOTW pattern:
  - In enforcement mode, "unknown, unsigned code [is] blocked by default".
  - Code runs only if Microsoft's cloud recognises it or it is "signed with a certificate issued by a CA within the Trusted Root Program".
  - Microsoft's SmartScreen page says SAC checks "apply to all executable files, not just those downloaded from the Internet".
  - SAC turns itself off in evaluation mode for users it judges to be developers or corporate users.

  ([Smart App Control](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview), [SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation))

  This matters for the **unsigned PBS `python.exe`** and for unsigned `.pyd` files in wheels on SAC-enforcing machines.

## 5. macOS: code signing, notarization, Gatekeeper for binaries fetched at plugin-install time

- **Notarization requirements** ([Apple: Notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)):
  - Developer ID signature on **all** executables
  - hardened runtime
  - secure timestamp
  - no `get-task-allow`
  - linked against the 10.9+ SDK
  - XML entitlements
- **Plug-ins:** "apps can load quarantined plug-ins — those downloaded from the internet or transferred with AirDrop — only if the plug-in is notarized." Plug-ins "inherit the entitlements of the host process" (same source).
- **Network installers:** "If you use a network installer, separately notarize both the installer and the items it downloads." The notary service accepts **UDIF disk images, signed flat `.pkg`, and ZIP**. It issues tickets for the top-level file and each nested item ([Customizing the notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)). The ticket is also published online, so Gatekeeper can find it without stapling when the machine has network access (same source). Apple's docs list `.app`, `.dmg` and `.pkg` as stapleable. Bare Mach-O files and ZIPs cannot carry a stapled ticket; they rely on the online lookup.
- **Quarantine is opt-in for the writing app.** `LSFileQuarantineEnabled` is "a Boolean value indicating whether the files this app creates are quarantined by default" ([Apple](https://developer.apple.com/documentation/bundleresources/information-property-list/lsfilequarantineenabled)). So the Hub's choice of download mechanism decides whether Gatekeeper's first-launch check applies to plugin binaries:
  - Chromium's download manager applies quarantine.
  - Plain Node `https` + `fs` writes do not, unless the Hub sets the attribute or enables `LSFileQuarantineEnabled`.

  *This is Apple's documented model. Behaviour of specific Electron download APIs should be verified on a test Mac.*
- **Apple's general statement:** "all software in macOS is checked for known malicious content the first time it's opened", and Gatekeeper "tracks the provenance of files written by downloaded software" ([Apple Platform Security: Gatekeeper](https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web)).
- **Apple Silicon requires a signature on native code.** An ad-hoc signature is enough to *run*, and the linker adds one automatically for arm64. Tools that modify a binary after linking, such as `install_name_tool` or `strip`, can invalidate it. Ad-hoc signatures don't satisfy Gatekeeper ([Eclectic Light summary of Apple's Big Sur notes](https://eclecticlight.co/2020/08/22/apple-silicon-macs-will-require-signed-code/); secondary, quoting Apple).
- **Library validation (hardened runtime):** it "prevents a program from loading frameworks, plug-ins, or libraries unless they're either signed by Apple or signed with the same Team ID". The opt-out entitlement is `com.apple.security.cs.disable-library-validation`, and "Gatekeeper runs extra security checks on programs that have it disabled" ([Apple](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.cs.disable-library-validation)). "Shared libraries, frameworks, and in-process plug-ins inherit the entitlements of their host executable" ([Hardened Runtime](https://developer.apple.com/documentation/security/hardened-runtime)).
- **What this means for a Python interpreter the Hub spawns as a child process** (derived from the above):
  - The Electron app's entitlements don't apply. Python is its own executable with its own signature.
  - If the Hub signs `python3` with Developer ID + hardened runtime, every wheel `.so`/`.dylib` it imports (cv2, PyMuPDF, numpy, greenlet, Playwright's driver) must either be re-signed with the same Team ID, or python must carry `disable-library-validation`.
  - Notarization requires the hardened runtime on whatever you submit.
  - A Python app notarization guide also reports needing `com.apple.security.cs.allow-unsigned-executable-memory` ([haim.dev](https://haim.dev/posts/2020-08-08-python-macos-app); secondary). This is consistent with ctypes/libffi needing writable-executable memory.
- **Tools:** `notarytool` is required; altool is deprecated and rejected since 2023-11-01 ([Apple](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)). Signing and notarizing from non-Mac CI is possible with `rcodesign`, a pure-Rust implementation by the PBS author ([apple-codesign docs](https://gregoryszorc.com/docs/apple-codesign/stable/), referenced in [PBS #749](https://github.com/astral-sh/python-build-standalone/issues/749)). Electron's own signing uses `@electron/osx-sign` and `@electron/notarize` ([Electron](https://www.electronjs.org/docs/latest/tutorial/code-signing)).
- **Playwright browser:** the Chromium Playwright downloads is a separate set of executables. The docs say nothing about its signing or notarization status. Driving the already-installed, vendor-signed Chrome or Edge via `channel=` avoids shipping a browser at all ([Playwright browsers](https://playwright.dev/python/docs/browsers)).

---

## 6. Trade-off summary (no decision)

| Axis | Favours |
|---|---|
| Smallest total disk / download when several plugins share heavy deps | Shared runtime (PBS + uv venvs with hardlink/clone dedupe) |
| Fewest moving parts on the client (no package resolver at install time) | Frozen per-plugin bundles (PyInstaller / Nuitka) or pre-vendored wheel sets |
| No per-plugin CI matrix | PBS + uv (wheels from PyPI or a private index) |
| Signed-out-of-the-box Windows interpreter | Embeddable (PSF-signed). PBS needs Hub re-signing |
| One model for both OSes | PBS + uv. Embeddable is Windows-only |
| Simplest macOS signing story | Re-signing a fixed runtime once vs signing every plugin's native files at registry-publish time, each with library-validation consequences |
| Intel Mac support | All options, subject to opencv-python's macOS 14+ floor on x86_64 |
| Known Windows AV friction | PyInstaller is the most documented. All unsigned executables are exposed to Smart App Control |

## 7. Open questions to verify empirically

1. On a stock Apple Silicon and an Intel Mac: does a PBS interpreter plus wheels downloaded by the Hub (Node `fs`, no quarantine) run with no Gatekeeper prompt? Does the same hold when the files are quarantined?
2. Does a Developer-ID + hardened-runtime-signed PBS `python3` import cv2/PyMuPDF/numpy without `disable-library-validation` if those wheels' Mach-O files are re-signed with the same Team ID at registry-publish time? Is `allow-unsigned-executable-memory` still needed?
3. Is the Chromium build that `playwright install` downloads signed and notarized on macOS? Is `channel="msedge"` (Edge is preinstalled on Windows) acceptable for the plugins?
4. Are any staff Windows 11 machines in Smart App Control enforcement mode? Does unsigned PBS `python.exe` get blocked there? Do staff machines run a third-party AV that adds launch latency (uv #10288)?
5. Does `uv pip install --target` / `--python` work cleanly against the python.org embeddable package (`._pth`, no `site`)? Not documented by either project.
6. The minimum macOS version across the Intel Mac fleet, given opencv-python 5.x needs macOS 14+ on x86_64.
