# Maestro capability verification — Phase 4, Task 0 (code-based)

Maestro is **missing on this VM**: no `maestro` binary (`which maestro`
exits 1), no emulator, no device. Nothing below was run live; every
answer is verified against Maestro's own documentation and source
(checked 2026-11-13), and the pinned schema in
`src/testorbit/domain/maestro-schema.ts` encodes exactly what is expressible.
The live `maestro test` run is pending a pilot app + Maestro, at testing
time on a real app. No public demo app is used as a stand-in.

## Answers

| Question (Phase 4 task 0) | Answer | Evidence |
|---|---|---|
| Per-step timeouts? | **No.** Maestro has no per-command timeout field. Element lookup is a hardcoded ~17 s (`Orchestra.kt`, per source analysis). | Plan fallback applies: `timeoutMs` lives in the JSON test case only; the YAML carries no timeout. |
| Syntax-only validation mode? | **No dedicated mode found.** | Plan fallback applies: Phase 4 Verify validates generated YAML with the pinned Zod schema (`parseMaestroYaml`), not a dry run. |
| `assertVisible` by resource-id? | **Yes.** `assertVisible: { id: "<resourceId>" }`; `tapOn` accepts the same `{ id }` selector. | Maestro selector docs (text / id / accessibility). |
| Per-step timing in Maestro's report? | **Yes, via `--debug-output`.** `maestro test --format junit --output <file>` writes per-flow JUnit; the `--debug-output` directory holds `commands-*.json` (command execution metadata: status, duration, errors) — that is the per-step timing source the Runner parses. JUnit alone is per-flow, not per-step. | Maestro CLI source (`maestro-cli/.../report/`, `--debug-output` option). |
| Long-press? | **Yes, as `longPressOn`** (also `tapOn` with `longPress: true`). The plan draft's `longPress` command name does not exist. | Maestro flow docs; pinned name is `longPressOn`. |
| Swipe syntax? | **Yes.** `swipe: { direction: UP\|DOWN\|LEFT\|RIGHT, duration: <ms> }`, or start/end percentages. | Maestro flow docs (`YamlSwipe`). |
| `pressKey`? | **Yes.** `- pressKey: ENTER` / `BACK` / `HOME` (Android key names). | Maestro flow docs. |
| Setup/teardown mapping? | **Yes.** Setup → `launchApp: { clearState: true }`; teardown → `onFlowComplete: - clearState`. | Maestro flow docs. |

## What the pinned schema covers

Exactly the nine C2 commands — `launchApp`, `tapOn`, `inputText`,
`longPressOn`, `swipe`, `pressKey`, `assertVisible`,
`assertNotVisible`, `clearState` — validated as YAML-parses plus the
command whitelist. Anything outside the nine fails validation naming
the command.

## Pending live proof

- `maestro test` of a generated flow, 3× from reset via `orbit run`,
  with 0 LLM calls on replay — pending a named pilot app + Maestro
  installed on a machine with a device/emulator.
- Per-step timings from a real `--debug-output` `commands-*.json` —
  the Runner's parser is best-effort and defensive until a real file
  is seen; total duration is always recorded.
