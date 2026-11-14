# Tools Reference

Detailed tool descriptions grouped by workflow. The complete, current runtime registry is maintained in the [generated tool inventory](../generated-tool-inventory.md). Run `npm run docs:generate` after adding or removing tools; CI checks the generated inventory for drift. Only `device`, `ui-automation`, `session-management`, `doctor`, `workflow-discovery`, and `testing-intelligence` are enabled by default - see [workflow.md](./workflow.md).

## device _(enabled by default)_

Build, install, launch, stop, test, and transfer files to/from Android targets - emulators and physical devices together, since adb doesn't distinguish the way Xcode's simctl/devicectl split does.

### `list_devices`
List every connected Android target - booted emulators and physical devices together, the same way `adb devices -l` does. Each entry reports id (adb serial), type ('emulator'|'physical'), state, and avdName when resolvable.

- **Title:** List Devices
- **Parameters:** _none_
- **Annotations:** read-only, idempotent

### `build_device`
Compile-only build for a Gradle module + variant (assemble<Variant>). Does not install or launch. Works identically whether you plan to target an emulator or a physical device - both use the same adb, unlike Xcode's simulator/device split.

- **Title:** Build (Device)
- **Parameters:** `projectPath`, `module`, `variant`, `extraArgs`
- **Annotations:** idempotent

### `build_run_device`
One-shot: build a module + variant, install it, and launch it. Resolves the target automatically - an explicit targetId wins, then the active session default, then whichever single emulator/device is connected; if more than one is connected without a pin, this fails with the candidate list instead of guessing. Launches via the default launcher activity unless `activity` is given.

- **Title:** Build, Install, and Launch
- **Parameters:** `projectPath`, `module`, `variant`, `targetId`, `activity`, `extraArgs`
- **Annotations:** mutating

### `install_app_device`
Install an already-built APK for a module + variant onto the resolved target. Does not rebuild - run build_device first if sources changed. Pass apkPath directly to skip variant lookup entirely.

- **Title:** Install App
- **Parameters:** `projectPath`, `module`, `variant`, `apkPath`, `targetId`, `reinstall`
- **Annotations:** idempotent

### `launch_app_device`
Launch an already-installed app on the resolved target. Provide packageId directly, or module/variant to look it up from the last build's APK. Uses the app's default launcher activity unless `activity` is given.

- **Title:** Launch App
- **Parameters:** `packageId`, `module`, `variant`, `projectPath`, `activity`, `targetId`
- **Annotations:** mutating

### `stop_app_device`
Force-stop a running app on the resolved target (adb shell am force-stop).

- **Title:** Stop App
- **Parameters:** `packageId`, `targetId`
- **Annotations:** destructive, idempotent

### `uninstall_app_device`
Uninstall an app (and its data) from the resolved target.

- **Title:** Uninstall App
- **Parameters:** `packageId`, `targetId`, `keepData`
- **Annotations:** destructive, idempotent

### `clear_app_data_device`
Reset an app to first-install state on the resolved target (adb shell pm clear) - wipes the app's data and cache without uninstalling it.

- **Title:** Clear App Data
- **Parameters:** `packageId`, `targetId`
- **Annotations:** destructive, idempotent

### `test_device`
Run Native Android Gradle tests or Flutter tests. Native `unit` runs test<Variant>UnitTest and `instrumented` runs connected<Variant>AndroidTest. Flutter `unit` runs `flutter test` for unit/widget tests; Flutter `instrumented` runs `flutter test -d <device-id> integration_test` when `integration_test/` exists.

- **Title:** Test (Device)
- **Parameters:** `projectPath`, `module`, `variant`, `targetId`, `kind`, `extraArgs`
- **Annotations:** mutating

### `push_file_device`
Copy a local file or directory onto the resolved target (adb push).

- **Title:** Push File
- **Parameters:** `localPath`, `remotePath`, `targetId`
- **Annotations:** idempotent

### `pull_file_device`
Copy a file or directory off the resolved target onto the local filesystem (adb pull).

- **Title:** Pull File
- **Parameters:** `remotePath`, `localPath`, `targetId`
- **Annotations:** read-only, idempotent

## emulator-management

Create, boot, wipe, and configure AVDs: location, dark/light appearance, status-bar demo mode, screen recording.

### `list_avds`
List every configured Android Virtual Device (avdmanager list avd) - not just the ones currently booted. Use list_devices for what's actually running.

- **Title:** List AVDs
- **Parameters:** _none_
- **Annotations:** read-only, idempotent

### `create_avd`
Create a new Android Virtual Device. systemImage must already be installed via sdkmanager, e.g. "system-images;android-34;google_apis;arm64-v8a". Auto-answers the "custom hardware profile" prompt with no.

- **Title:** Create AVD
- **Parameters:** `name`, `systemImage`, `device`, `force`
- **Annotations:** mutating

### `delete_avd`
Permanently delete an Android Virtual Device and its data.

- **Title:** Delete AVD
- **Parameters:** `name`
- **Annotations:** destructive, idempotent

### `boot_emulator`
Boot an AVD by name and wait until it reaches adb state "device". Boots headless (-no-window) by default - pass headless:false for a visible window (needs a display available on this machine).

- **Title:** Boot Emulator
- **Parameters:** `avdName`, `headless`, `wipeData`, `extraArgs`, `timeoutMs`
- **Annotations:** mutating

### `erase_emulator`
Wipe an AVD back to a factory-fresh state. If it's currently running, kills it first, then reboots with -wipe-data and waits for "device" state.

- **Title:** Erase Emulator (Wipe Data)
- **Parameters:** `avdName`, `headless`, `timeoutMs`
- **Annotations:** destructive

### `set_emulator_location`
Fake the GPS location on a booted emulator via the emulator console (adb emu geo fix). Emulator-only - physical devices have no console to fix location on.

- **Title:** Set Emulator Location
- **Parameters:** `latitude`, `longitude`, `targetId`
- **Annotations:** idempotent

### `set_emulator_appearance`
Toggle system dark/light theme on the resolved target (adb shell cmd uimode night yes|no). Needs API 29+ (Android 10+).

- **Title:** Set Appearance (Dark/Light Mode)
- **Parameters:** `mode`, `targetId`
- **Annotations:** idempotent

### `emulator_statusbar`
Enter or exit system-ui "demo mode" for clean screenshots: fixed 12:00 clock, full battery, full signal/wifi, notifications hidden. Uses the same android.permission-free demo-mode broadcasts every screenshot tool relies on.

- **Title:** Status Bar Demo Mode
- **Parameters:** `action`, `targetId`
- **Annotations:** idempotent

### `open_emulator`
Ensure an AVD is running with a visible window, for manual/visual workflows. If it's already running headless, a window can't be attached after the fact - this reports that and leaves it running rather than restarting it out from under you.

- **Title:** Open Emulator (Visible Window)
- **Parameters:** `avdName`, `timeoutMs`
- **Annotations:** mutating

### `record_emulator_video`
Start or stop an on-device screen recording (adb shell screenrecord) and pull the resulting .mp4 to the local filesystem on stop. Works on both emulators and physical devices.

- **Title:** Record Screen Video
- **Parameters:** `action`, `targetId`, `processId`, `localOutputPath`
- **Annotations:** mutating

## ui-automation _(enabled by default)_

Semantic UI snapshots, screenshot OCR coordinates, selector-based form filling, declarative JSON workflows using Google's Android CLI, and tap/swipe/drag/type/key/gesture/wait/batch.

### `snapshot_ui`
Capture the semantic UI hierarchy and cache short-lived elementRefs. By default, saves the raw hierarchy XML and full parsed tree under `.testorbit/artifacts/snapshots/` and returns a compact summary; set `includeElements=true` to include elements inline. Refresh after navigation, scrolling, or any layout change.

- **Title:** Snapshot UI
- **Parameters:** `targetId`, `projectPath`, `interactiveOnly`, `persist`, `includeElements`
- **Annotations:** read-only

### `tap`
Tap either a raw (x, y) point or an elementRef from the latest snapshot_ui output. Prefer elementRef - it survives minor layout shifts that would break a hard-coded coordinate.

- **Title:** Tap
- **Parameters:** `elementRef`, `x`, `y`, `targetId`
- **Annotations:** mutating

### `long_press`
Long-press either a raw (x, y) point or an elementRef from the latest snapshot_ui output.

- **Title:** Long Press
- **Parameters:** `elementRef`, `x`, `y`, `durationMs`, `targetId`
- **Annotations:** mutating

### `swipe`
Swipe either by explicit start/end coordinates, or a screen-relative direction ("up"|"down"|"left"|"right") computed from the current screen size.

- **Title:** Swipe
- **Parameters:** `direction`, `distance`, `startX`, `startY`, `endX`, `endY`, `durationMs`, `targetId`
- **Annotations:** mutating

### `drag`
Press-and-drag from one point to another (adb shell input draganddrop) - for reordering list items or drag targets, where a quick swipe would be interpreted as a flick instead of a hold-and-move. Endpoints can be elementRefs from the latest snapshot_ui, or raw coordinates.

- **Title:** Drag
- **Parameters:** `startElementRef`, `endElementRef`, `startX`, `startY`, `endX`, `endY`, `durationMs`, `targetId`
- **Annotations:** mutating

### `type_text`
Type text into whatever field currently has focus. If elementRef is given, taps it first to focus it, then types. Only ASCII-range and common Latin text renders reliably through adb input text - non-Latin scripts and emoji generally need an IME-level workaround this tool does not attempt.

- **Title:** Type Text
- **Parameters:** `text`, `elementRef`, `targetId`
- **Annotations:** mutating

### `key_press`
Send one hardware/software key event (adb shell input keyevent). Accepts either a symbolic Android keycode name (KEYCODE_BACK, KEYCODE_ENTER, KEYCODE_DEL, KEYCODE_TAB) or its numeric code. Prefer button for common hardware buttons (home/back/recents/power/volume) - it maps friendly names for you.

- **Title:** Key Press
- **Parameters:** `keyCode`, `targetId`
- **Annotations:** mutating

### `hide_keyboard`
Dismiss the on-screen keyboard using KEYCODE_ESCAPE (111) by default, or KEYCODE_BACK (4) when strategy is `back`.

- **Title:** Hide Keyboard
- **Parameters:** `targetId`, `strategy`
- **Annotations:** idempotent

### `button`
Press a named hardware/system button: home, back, recents, power, volume_up, volume_down, menu, enter, camera.

- **Title:** Hardware Button
- **Parameters:** `button`, `targetId`
- **Annotations:** mutating

### `gesture`
Named system gesture presets: expand_notifications, expand_quick_settings, collapse_statusbar (all via `cmd statusbar`, no coordinates needed), swipe_up_from_bottom (home/app-switcher gesture-nav swipe), swipe_down_from_top (notification-shade swipe as an alternative to expand_notifications on older API levels).

- **Title:** Gesture Preset
- **Parameters:** `preset`, `targetId`
- **Annotations:** mutating

### `screenshot`
Capture a screenshot, always save it under `.testorbit/artifacts/screenshots/<targetId>-<timestamp>.png`, and return the image with the absolute saved path in the text response.

- **Title:** Screenshot
- **Parameters:** `targetId`, `projectPath`, `outputPath`
- **Annotations:** read-only, idempotent

### `analyze_screenshot`
Run local Tesseract OCR on the current Android screenshot and return visible text with pixel bounds and center coordinates. Requires Tesseract installed separately; use `snapshot_ui` for semantic controls and non-text elements.

- **Title:** Analyze Screenshot
- **Parameters:** `targetId`, `language`, `minConfidence`, `mode`, `timeoutMs`
- **Annotations:** read-only, idempotent

### `fill_form`
Fill visible form fields by unique semantic selectors, refresh the hierarchy between fields, and optionally tap a unique submit control. Missing or ambiguous matches fail safely.

- **Title:** Fill Form
- **Parameters:** `targetId`, `fields`, `clearExisting`, `submit`
- **Annotations:** mutating

### `run_ui_workflow`
Execute a JSON-defined sequence from `.testorbit/workflows/`, using screen definitions under `.testorbit/screens/`. Supports taps, text input, waits, screen assertions, back/key actions, and writes a per-run report. Prefers the official Android CLI for semantic interaction; ADB is used for explicit coordinate-tap fallback.

- **Title:** Run UI Workflow
- **Parameters:** `workflowFile`, `projectPath`, `deviceId`
- **Annotations:** mutating

See [Declarative UI workflows](../ui-workflows.md) and [Screenshot OCR](../screenshot-analysis.md).

### `wait_for_ui`
Poll the UI until a condition holds, then record the latest snapshot (same caching as snapshot_ui - refs from the result are usable directly). With textContains/resourceId: waits for a matching element to appear (or disappear, if gone:true). With neither: waits for the hierarchy to stop changing between polls ("settled").

- **Title:** Wait For UI
- **Parameters:** `textContains`, `resourceId`, `gone`, `timeoutMs`, `pollIntervalMs`, `targetId`
- **Annotations:** read-only

### `batch`
Run several same-screen UI actions in one call, resolving the target once and reusing it for every step. Use for multiple taps/toggles with no intermediate assertion needed - if you need to check state between steps, call the individual tools instead so you can inspect each result.

- **Title:** Batch
- **Parameters:** `steps`, `targetId`
- **Annotations:** mutating

### `touch`
Send a raw touch event (adb shell input motionevent) rather than a full tap/swipe gesture. Use for composing custom multi-point sequences - e.g. DOWN, several MOVEs, then UP - that the higher-level tap/swipe/drag tools don't expose.

- **Title:** Touch (raw down/up/move)
- **Parameters:** `x`, `y`, `action`, `targetId`
- **Annotations:** mutating

## debugging

Logcat streaming, crash and ANR extraction, log clearing, full adb bugreport. Log/crash-focused by design - no JDWP breakpoint debugging in this version.

### `start_log_capture`
Start streaming logcat from the resolved target to a background buffer. Returns a processId - pass it to stop_log_capture to retrieve everything captured and end the stream.

- **Title:** Start Log Capture
- **Parameters:** `targetId`, `filterSpec`, `packageId`
- **Annotations:** read-only

### `stop_log_capture`
Stop a log capture started by start_log_capture and return everything buffered (tail, if very large).

- **Title:** Stop Log Capture
- **Parameters:** `processId`
- **Annotations:** idempotent

### `get_crash_report`
Dump the dedicated logcat "crash" buffer (adb logcat -d -b crash), which holds uncaught Java/Kotlin exception traces separately from the main log. Optionally filter to lines mentioning a specific packageId.

- **Title:** Get Crash Report
- **Parameters:** `targetId`, `packageId`
- **Annotations:** read-only, idempotent

### `get_anr_trace`
Find "ANR in <package>" entries in logcat (system_server's standard signal for a hang), and try to also pull matching files from /data/anr/. The /data/anr/ read can fail with permission denied on a non-debuggable, production-signed physical device - that's a real platform restriction, not a bug, and the logcat-based result still comes back either way.

- **Title:** Get ANR Trace
- **Parameters:** `targetId`, `packageId`
- **Annotations:** read-only, idempotent

### `clear_logs`
Clear the on-device logcat buffer (adb logcat -c) so the next capture starts from a clean slate.

- **Title:** Clear Logs
- **Parameters:** `targetId`
- **Annotations:** destructive, idempotent

### `bug_report`
Generate a full adb bugreport (system state, logs, dumpsys output for every service) and save it locally as a .zip. This is comprehensive but slow - budget 1-3 minutes.

- **Title:** Bug Report
- **Parameters:** `targetId`, `localOutputPath`
- **Annotations:** read-only, idempotent

## coverage

Read JaCoco XML coverage reports, overall and per source file.

### `get_coverage_report`
Read a JaCoco XML coverage report and summarize instruction/line/branch/method/class coverage overall and per package. Looks under <module>/build/reports/jacoco/** for the newest report unless reportPath is given directly - run your module's jacocoTestReport Gradle task first if none exists yet.

- **Title:** Get Coverage Report
- **Parameters:** `projectPath`, `module`, `reportPath`
- **Annotations:** read-only, idempotent

### `get_file_coverage`
Show coverage for one source file (matched by filename, e.g. "MainActivity.kt") from a JaCoco XML report - instruction/line/branch/method counters, scoped to that file only.

- **Title:** Get File Coverage
- **Parameters:** `fileName`, `projectPath`, `module`, `reportPath`
- **Annotations:** read-only, idempotent

## project-discovery

Find Gradle project roots, list modules and build variants, inspect build configuration.

### `discover_projects`
Scan a directory (default: cwd) for Gradle project roots (folders containing settings.gradle or settings.gradle.kts). Use when the project path is unknown.

- **Title:** Discover Projects
- **Parameters:** `searchPath`, `maxDepth`
- **Annotations:** read-only, idempotent

### `list_modules`
List Gradle module paths declared in settings.gradle[.kts] via include(...). Static text parsing, not DSL evaluation - a settings file that builds its include list programmatically may not be fully captured.

- **Title:** List Modules
- **Parameters:** `projectPath`
- **Annotations:** read-only, idempotent

### `list_variants`
List build variants actually configured for a module, by asking Gradle itself (gradlew :module:tasks --all and reading off every generated assemble<Variant> task) rather than parsing build.gradle DSL - accurate regardless of how flavors/build types were declared, version catalogs, or convention plugins.

- **Title:** List Variants
- **Parameters:** `projectPath`, `module`
- **Annotations:** read-only, idempotent

### `show_build_config`
Report a module's build configuration. If `variant` is given and already built, reads the real applicationId/versionName/versionCode/launchable activity straight from the built APK (aapt2 dump badging) - the most reliable source. Otherwise falls back to best-effort regex extraction from build.gradle[.kts], which can't resolve variables or version-catalog references.

- **Title:** Show Build Config
- **Parameters:** `projectPath`, `module`, `variant`
- **Annotations:** read-only, idempotent

## testing-intelligence (10 tools)

- `analyze_test_project` — inspect Native Android/Flutter project markers and available test files.
- `save_test_instructions` — persist user-authored Markdown instructions without overwriting existing files unless explicitly authorized.
- `write_test_report` — write redacted Markdown/JSON reports to `.testorbit/test-reports/YYYY-MM-DD/<time>-<run-id>/`.
- `save_test_case` — persist a structured reusable test case.
- `list_test_cases` — list saved test cases.
- `audit_screen` — inspect the active screen for UI issues and relevant log errors.
- `run_test_case` — run a stored test case through supported automation.
- `analyze_changes` — map Git changes to focused test suites, with broad-regression fallback when impact is uncertain; does not execute tests.
- `resolve_test_instructions` — merge global, project, feature, and run-specific instruction layers.
- `validate_test_plan` — validate explicit test goals and steps; incomplete plans are blocked rather than executed.

These tools provide reusable planning, selection, and reporting. A plan is not proof that tests ran; only explicit execution outcomes are reported as passed.
