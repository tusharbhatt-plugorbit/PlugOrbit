# PlugOrbit

PlugOrbit is an EV charging and journey companion built with React Native and a
Python FastAPI backend. It includes passwordless sign-in, charger discovery,
vehicle and battery setup, journey planning, charging tools, and Orbit Assist.

This is the contributor guide for `main`. Commands below use **Windows PowerShell**
unless explicitly labelled otherwise. Run commands from the directory stated above
each block. Examples use `feature/my-change`; replace it with your own branch name.

## Contents

- [Code summary](#code-summary)
- [Prerequisites](#prerequisites)
- [First-time setup](#first-time-setup)
- [Run backend and frontend](#run-backend-and-frontend)
- [Run on a physical Android phone](#run-on-a-physical-android-phone)
- [Stop the application](#stop-the-application)
- [Git: pull, branch, push and merge](#git-pull-branch-push-and-merge)
- [Tests and build checks](#tests-and-build-checks)
- [Troubleshooting](#troubleshooting)
- [Important development rules](#important-development-rules)
- [Further documentation](#further-documentation)

## Code summary

| Location | Purpose |
|---|---|
| `LoginApp/` | React Native mobile frontend; the installed application is named PlugOrbit |
| `LoginApp/App.tsx` | Application entry and authentication/application composition |
| `LoginApp/src/navigation/` | Typed route registry, tabs, stack and navigation context |
| `LoginApp/src/screens/` | Authentication, Home, discovery/map, trips, Smart Drive, assistant, vehicle, charging, activity and profile screens |
| `LoginApp/src/ui/`, `src/theme/` | Shared buttons, forms, keyboard-aware layouts, sheets and navy/lime design tokens |
| `LoginApp/src/store/` | Application state, local persistence and cloud synchronization |
| `LoginApp/src/services/` | Backend clients, OTP/session handling, GPS, Places and typed service interfaces |
| `LoginApp/src/services/mock/` | Preview implementations for routes, charging, payments and other service boundaries |
| `LoginApp/src/intelligence/` | Deterministic energy, charging recommendation and journey-monitoring logic |
| `LoginApp/src/assistant/` | Conversation controller, tool adapters, approved actions, proactive events and native speech |
| `LoginApp/src/appearance.tsx` | System / Light appearance: recolors themed style sheets for the dark palette |
| `LoginApp/src/config/servicesMode.ts` | Live vs demo data (`SERVICES_MODE`, or live once a Places key is set) |
| `LoginApp/android/`, `ios/` | Native platform projects, permissions and build configuration |
| `LoginApp/scripts/` | Native voice compatibility patch and emulator UI QA helper |
| `LoginApp/__tests__/` | Frontend unit, component, integration-boundary and navigation tests |
| `Backend/app/main.py` | FastAPI application; health route and router registration |
| `Backend/app/routes/`, `services/` | Authentication (OTP, Google), OTP delivery, user data, support tickets, the help-guide chat and Firebase-backed app-state services |
| `Backend/app/ai/` | Isolated authenticated LLM gateway, tool protocol, sessions, limits and usage estimates |
| `Backend/tests/`, `scripts/` | Backend tests and optional live Firebase diagnostics |
| `LoginApp/docs/` | Architecture, product behavior, assistant setup and review reports |

### How the parts connect

1. The mobile app calls FastAPI for OTP authentication, session refresh and cloud sync.
2. FastAPI uses Firebase Admin/Auth/Firestore when configured; the mobile app does
   not contain a Firebase Admin credential.
3. The map uses the existing native map integration and Places requests; Android
   also has an OSM/WebView fallback. Google Maps directions can open externally.
4. Smart Drive defaults its origin to device GPS, with manual city entry when GPS
   is unavailable. Its existing route and monitoring services still produce preview plans.
5. Orbit Assist sends consented text/context through the authenticated backend to
   Anthropic. Read-only tool adapters consult app services; deterministic code does
   the calculations. Action cards require driver approval.
6. Voice uses the phone's speech recognizer and text-to-speech engine. Installed
   speech services, microphone permission and language availability affect support.

**Live services and preview data are different.** Maps, GPS, Places, OTP delivery,
Firebase sync and LLM responses depend on configuration and connectivity. Operator
availability, payments, charging control, bookings and vehicle telemetry must not
be assumed production-ready simply because their screens exist. See the
[handoff](LoginApp/docs/HANDOFF.md) and [quality review](LoginApp/docs/QUALITY_REVIEW.md).

## Prerequisites

| Tool | Requirement |
|---|---|
| Git | Installed with access to this GitHub repository |
| Node.js / npm | Node **22.11.0 or newer**, as declared in `LoginApp/package.json` |
| Python | Python 3.10+ syntax is used; the reviewed local environment uses **3.13** |
| Android Studio | SDK Manager, Device Manager and an emulator or USB-connected device |
| Android SDK | Platform **37**, Build Tools **37.0.0**, NDK **27.1.12297006**, as pinned by the Android project |
| Java | A JDK compatible with the checked-in Android Gradle Plugin and Gradle **9.4.1**; configure Android Studio's Gradle JDK consistently |
| iOS development | macOS, compatible Xcode, Ruby/Bundler and CocoaPods; iOS cannot build on Windows |

The first installation/build needs internet access. Use the checked-in Gradle
wrapper rather than installing an unrelated Gradle version.

## First-time setup

### 1. Clone the main branch

From the folder where you keep projects:

```powershell
git clone https://github.com/tusharbhatt-plugorbit/PlugOrbit.git
cd PlugOrbit
git switch main
git pull --ff-only origin main
```

For a private repository, authenticate using Git Credential Manager, GitHub CLI
or your organization's approved method. Do not put a token in the clone URL.

### 2. Set up the backend

From the repository root:

```powershell
cd Backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
cd ..
```

Using the virtual environment's Python directly avoids PowerShell activation-policy
issues. For a runtime-only installation, use `requirements.txt`; development
requirements also install pytest.

Configure `Backend/.env` locally using its template:

| Settings | Purpose |
|---|---|
| `FIREBASE_WEB_API_KEY`, one supported Firebase Admin credential source | Firebase login sessions and cloud data |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_USE_TLS` | Email OTP delivery; the code uses **SMTP_USERNAME**, not SMTP_USER |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | SMS OTP delivery |
| `ANTHROPIC_API_KEY`, optional `ASSISTANT_*` settings | Server-side Orbit Assist model access and limits |
| `OTP_DEV_FALLBACK`, `OTP_DEV_FALLBACK_SESSIONS` | Local-development-only OTP behavior |

Firebase Admin keys, SMTP passwords and AI keys stay on the backend. See
[Backend setup](Backend/README.md) for credential-source options. Do not enable
development OTP fallbacks on a publicly accessible deployment. Screen-displayed
codes do not establish a cloud session by default.

### 3. Set up the mobile frontend

From the repository root:

```powershell
cd LoginApp
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
cd ..
```

`npm ci` installs the lockfile versions and runs the checked-in native voice
compatibility patch. Do not skip install scripts: the existing speech libraries
need these Android Gradle compatibility changes. Upgrading them requires reviewing
`scripts/patch-voice-android.cjs`.

Configure `LoginApp/.env` using its template:

| Setting | Purpose |
|---|---|
| `GOOGLE_MAPS_ANDROID_KEY` | Android Maps SDK |
| `GOOGLE_MAPS_IOS_KEY` | iOS Maps SDK |
| `GOOGLE_PLACES_API_KEY` | Places API (New), nearby charger lookup |
| `API_BASE_URL` | Backend URL; blank uses platform development defaults |
| `MAP_TILE_*` | Optional fallback tile-provider configuration |

Use plain `NAME=value` lines; native parsers do not support all shell/.env syntax.
Restart Metro after changing JS environment values; native map-key changes also
require rebuilding. Mobile Google keys are extractable from the app: apply provider
restrictions and quotas. Keep AI, SMTP and Firebase Admin secrets out of the frontend.
Detailed Google key setup is in [LoginApp/README.md](LoginApp/README.md).

## Run backend and frontend

Keep **three terminals** open. Each example starts from the repository root.

### Terminal 1: FastAPI backend

```powershell
cd Backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- Health: <http://localhost:8000/health> (expected `{"status":"ok"}`).
- Interactive API documentation: <http://localhost:8000/docs>.
- Health only confirms the server is running; it does not prove Firebase, email,
  SMS, Google or Anthropic credentials work.
- `--reload` and this HTTP configuration are for development.

### Terminal 2: Metro frontend development server

```powershell
cd LoginApp
npm start
```

Metro uses port **8081**. It serves the JavaScript bundle; it does not install the
native application by itself.

### Terminal 3: install and launch Android

Start an AVD in Android Studio **Device Manager**, wait for it to finish booting,
then run:

```powershell
cd LoginApp
npm run android -- --no-packager
```

The Android emulator reaches the host backend through `http://10.0.2.2:8000`
when `API_BASE_URL` is blank. `localhost` inside Android normally means Android
itself, not your development computer.

### iOS, on macOS only

From the repository root, using a macOS terminal:

```bash
cd LoginApp
npm ci
bundle install
cd ios
bundle exec pod install
cd ..
npm start
```

In another terminal, from `LoginApp`, run `npm run ios`. Run the backend separately;
the iOS simulator's default backend URL is `http://localhost:8000`. Re-run pod
installation after iOS native dependency or map-key changes. iOS behavior still
needs testing on Xcode/simulator and real devices.

## Run on a physical Android phone

1. Enable Developer options and USB debugging on the phone.
2. Connect a data-capable USB cable, unlock the phone and accept its RSA debugging prompt.
3. Start the backend and Metro as above.
4. Check that ADB lists the phone as `device`, not `unauthorized` or `offline`.

From the repository root:

```powershell
$adbPath = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adbPath devices -l
```

Replace `DEVICE_SERIAL` below with that phone's serial. USB forwarding allows the
phone to use the development computer without a LAN IP:

```powershell
& $adbPath -s DEVICE_SERIAL reverse tcp:8081 tcp:8081
& $adbPath -s DEVICE_SERIAL reverse tcp:8000 tcp:8000
```

For this USB setup, configure `API_BASE_URL=http://localhost:8000` in your local
`LoginApp/.env`, then restart Metro. To target a particular device:

```powershell
cd LoginApp
npm run android -- --device DEVICE_SERIAL --no-packager
```

Alternative: set `API_BASE_URL=http://YOUR_COMPUTER_LAN_IP:8000`, connect phone and
computer to the same network, and allow backend traffic through the development
firewall. The backend must listen on `0.0.0.0`. Metro connectivity must also be
configured for the phone. USB reverse mappings may need reapplying after reconnecting.

## Stop the application

- Press **Ctrl+C** in the backend terminal to stop Uvicorn.
- Press **Ctrl+C** in the Metro terminal to stop the frontend bundle server.
- Stop the app separately on the phone/emulator; stopping Metro does not terminate
  the installed native process.

To stop only PlugOrbit on a selected Android device:

```powershell
$adbPath = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adbPath -s DEVICE_SERIAL shell am force-stop com.loginapp
```

Close the emulator through Device Manager when finished. Avoid killing every Node,
Python or Java process; other projects or Android Studio may be using them.

## Git: pull, branch, push and merge

Run Git commands from the repository root. A **commit** saves a local checkpoint;
a **push** uploads commits. Switching branches does not push, merge or erase work.

### Inspect your current state

```powershell
git status
git branch --show-current
git branch -a
git remote -v
git log -5 --oneline
```

### Pull the latest main

Commit your current work or stash it before switching branches:

```powershell
git switch main
git pull --ff-only origin main
```

`--ff-only` stops rather than creating an unexpected merge if your local main has
diverged. Inspect the history before resolving divergence; do not reset away commits.
For temporary unfinished work, `git stash push -u -m "unfinished work"` stores
tracked and untracked non-ignored files; `git stash pop` restores it later and can
produce conflicts. Ignored `.env` files are not included by `-u`.

### Make a feature branch

After updating main:

```powershell
git switch -c feature/my-change
```

Use names such as `fix/smart-drive-layout`, `feature/charger-filters`, or
`docs/setup-guide`. To enter an existing local branch, use
`git switch feature/my-change`. To check out a remote-only branch:

```powershell
git fetch origin
git switch --track origin/feature/my-change
```

### Commit and push the branch

Review the diff and run relevant checks first. Stage specific files, replacing
the example path with your changed files:

```powershell
git diff
git add README.md
git diff --cached
git commit -m "docs: improve contributor setup guide"
git push -u origin feature/my-change
```

The first push sets an upstream. Later pushes from the same branch can use
`git push`; `git pull --ff-only` downloads upstream changes when possible. Pushing
a feature branch **does not change main**.

### Bring main changes into your branch

Commit or stash unfinished work first:

```powershell
git fetch origin
git switch feature/my-change
git merge origin/main
```

If Git reports conflicts, run `git status`, edit each conflicted file, remove the
conflict markers, keep the correct combined behavior, then stage the resolved
files and complete the merge with `git commit`. Re-run checks and push the branch.
If you need to abandon an in-progress merge, use `git merge --abort` before
continuing other work.

### Merge a branch into main

**Team workflow:** push the feature branch, open a GitHub Pull Request with base
`main` and compare `feature/my-change`, review the diff/checks, then merge through
GitHub. Afterwards, synchronize your local main:

```powershell
git switch main
git pull --ff-only origin main
```

**Direct local merge, only when repository permissions and team policy allow it:**

```powershell
git switch main
git pull --ff-only origin main
git merge --no-ff feature/my-change -m "Merge feature/my-change"
# Run the relevant tests on the merged code before publishing.
git push origin main
```

If a push is rejected because main advanced, fetch the new history and integrate
it, or use a Pull Request. If branch protection rejects direct pushes, use a PR.
Do not force-push shared main to bypass either condition.

### Exit a branch / return to main

There is no Git `exit branch` command. Save or stash your changes, then:

```powershell
git switch main
```

This leaves the feature branch available. Optional cleanup **after** its work has
been merged and verified:

```powershell
git branch -d feature/my-change
git push origin --delete feature/my-change
git fetch --prune
```

Only delete a remote branch when the team no longer needs it. A squash-merged
branch may fail `git branch -d` because commit ancestry differs; verify the work
before deciding how to clean it up.

## Tests and build checks

From `LoginApp`:

```powershell
npx tsc --noEmit
npm run lint
npm test -- --runInBand
```

Targeted Smart Drive regression tests:

```powershell
npm test -- --runInBand __tests__/smartDrive.screens.test.tsx __tests__/smartDrive.service.test.ts
```

From `Backend`:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

Compile a debug APK, from `LoginApp/android`:

```powershell
.\gradlew.bat :app:assembleDebug
```

Output: `LoginApp/android/app/build/outputs/apk/debug/app-debug.apk`. This is a
development build, not a signed production release. Emulator-only x86_64 build:
`.\gradlew.bat :app:assembleDebug -PreactNativeArchitectures=x86_64`; do not use
that architecture-only APK for an ARM phone.

Automated tests do not prove real payments, microphone quality, hardware telemetry
or live provider credentials. Test keyboard-open forms, location permission,
320–430 dp layouts, camera, route actions and navigation on devices as applicable.
Firebase diagnostic commands in [Backend/README.md](Backend/README.md) can create
and delete temporary cloud records/accounts; run them only against an authorized project.

## Troubleshooting

| Problem | What to check |
|---|---|
| Backend cannot be reached | Check `/health`, port 8000, `API_BASE_URL`, emulator `10.0.2.2`, USB forwarding or LAN/firewall configuration |
| Login appears to work while backend is offline | Debug builds support an explicitly labelled local OTP fallback; this does not prove backend/Firebase connectivity |
| OTP email or SMS fails | Check provider configuration, especially `SMTP_USERNAME`, delivery permissions and Twilio trial restrictions; do not log credentials |
| Orbit Assist is unavailable | Check backend provider configuration and a valid Firebase session; local-only development sign-in may not authorize AI requests |
| `RNCWebViewModule` or another native module is missing | Run `npm ci`, rebuild/reinstall the native app, then restart Metro; JavaScript reload alone cannot add a native module |
| Voice library Gradle errors | Confirm postinstall ran and installed dependency versions match the compatibility patch; rebuild after native changes |
| Metro shows stale code/environment | Stop Metro, run `npm start -- --reset-cache` from LoginApp and reload/rebuild as needed |
| Map is blank | Check Maps SDK enablement, key restrictions, Android package/SHA-1, network access and native rebuild; preserve the existing map configuration |
| Smart Drive cannot find location | Grant location permission, enable location services, or enter a start city manually; emulator GPS must also be configured |
| Phone is `unauthorized` / `offline` in ADB | Unlock phone, approve debugging prompt, check the data cable/USB driver and recheck `adb devices -l` |
| Several devices are connected | Use the device serial in ADB and the CLI device option; avoid sending commands to an unintended phone |
| Emulator screen is black | Wait for boot, cold boot through Device Manager, check its graphics settings and app logs; an emulator graphics failure is not automatically a code defect |
| Port 8000 or 8081 is occupied | Stop the known server in its terminal; identify the owning process before terminating anything |
| Git authentication/push rejected | Check access, credentials, remote URL, remote history and branch protection; use a PR when required |

## Important development rules

- Preserve the map provider, authentication, existing API contracts and state architecture.
- Keep `.env`, service-account files, passwords and provider secrets out of Git,
  screenshots, logs and Pull Request descriptions. Commit `.env.example` templates only.
- Review `git diff --cached` before every commit; do not use broad staging blindly.
- Never describe sample data, forecasts or estimates as verified live telemetry.
- Never initiate a payment, booking or charging action through AI without supported
  integration and user authorization.
- Commit `package-lock.json` when dependencies change. Rebuild native apps after
  native dependency/configuration changes; Metro is not a native build system.
- Use HTTPS, restricted credentials, secure session storage, production signing,
  appropriate CORS and disabled development fallbacks before a public release.
- Keep release readiness separate from a passing debug build. See the documented
  integration and device-testing limitations before deployment.

## Further documentation

- [Mobile setup and Google/Firebase details](LoginApp/README.md)
- [Backend, Firebase, OTP and AI endpoints](Backend/README.md)
- [Frontend architecture](LoginApp/docs/ARCHITECTURE.md)
- [Integration handoff and preview boundaries](LoginApp/docs/HANDOFF.md)
- [Smart Drive engine](LoginApp/docs/SMART_DRIVE.md)
- [Orbit Assist architecture, setup and costs](LoginApp/docs/ASSISTANT_AI.md)
- [How the two feature branches were integrated, and what still needs a decision](LoginApp/docs/BRANCH_INTEGRATION.md)
- [Client demo readiness checklist](DEMO_READINESS.md) and [phone testing](LoginApp/PHONE_TEST.md)
- [UI and integration quality review](LoginApp/docs/QUALITY_REVIEW.md)
- [Demo walkthrough](LoginApp/docs/DEMO_WALKTHROUGH.md)
- [Product specification](LoginApp/docs/PRODUCT_SPEC.md)

Historical reports describe the code and tests at their stated review date; they
do not certify every later change or production integration.
