# Recorder

Phase 5 of the TestOrbit plan. The plan of record is
`~/workspace/test-automation-mcp/testorbit-final-implementation-plan.md`
(Part B B8, Part D D2/D7); this doc is the design summary the drift
report reads — it does not replace the plan.

## How recording works

Live recording happens through the MCP recording path
(`orbit_start_recording` + the UI tools), not through the CLI. The CLI's
`orbit record` is a **dry-run planner only** (see below).

Per recorded action the recorder captures **two hierarchy dumps**
(one before, one after the action) — the Phase 1 cost budget is
measured against two dumps per action, not one. Each action is
annotated with `screenId`, `variantId`, and `elementId`; a
`fingerprint` field is not stored (B4 abolished the fingerprint as
a comparable value). The match result lives in the Runner's run
report and failure bundle, not in recordings.

- **Screen identification (across screens, at record time):** the
  recorder has no expected screen, so it identifies the logical
  screen from scratch — the full B4 match rule applied to every
  learned `(screen, variant)` candidate. Among candidates that
  pass, score = (required elements present) − (excluded elements
  present); tie → more required elements wins; still tied → fail
  with evidence naming the candidates. Below threshold → `unknown
  screen` with the fresh hierarchy attached as evidence.
- **Navigation step:** any action after which the matched
  `(screen, variant)` changes, detected by comparing the pre/post
  match results. `isNavigationStep` is recorded per action.
- **Grounding fallback chain** (decided 2026-11-13 — no
  TensorFlow, no OpenCV): (1) screen tree (hierarchy) first;
  (2) Tesseract OCR on the screenshot (local, free); (3) LLM
  vision — the LLM looks at the screenshot and points at the
  element. Step 3 runs only when steps 1–2 fail, only at
  record/convert time, **never during replay**. Each action
  records `groundedBy: hierarchy | tesseract | llm-vision`.
- **Scroll policy:** bounded search, 8 swipes, counted.
- **One reader:** `src/testorbit/infrastructure/recording-reader.ts`
  accepts v1 + v2 recordings and is shared by the converter and
  the map generator, so the two readers cannot drift. v1
  recordings yield no edges and are labelled "unproven /
  start-stop only"; readers reject unknown versions (v3+)
  explicitly.

## Dry-run (Decision D3)

`orbit record` prints the ordered steps that WOULD be recorded,
with the resolved `(screen, variant, elementId)` per step, and
writes nothing. **Dry-run is the default**; `--no-dry-run`
prints the plan and says so instead of touching a device — the
CLI has no device-recording path of its own. The host-agent MCP
recording path has no dry-run and previews in chat instead.

## Code

- `src/testorbit/application/record-action.ts` — `RecordingDetector`
  (per-action detection + annotation; takes any
  `HierarchyProvider`).
- `src/testorbit/application/annotate-recording.ts` — recording
  annotation, incl. the LLM-vision override path.
- `src/tools/ui-automation/recording-probe.ts` — the MCP
  recording path wiring (Android only; see below).
- `src/testorbit/infrastructure/hierarchy-provider.ts` — Android
  (adb) hierarchy provider.
- `src/testorbit/infrastructure/ios-hierarchy-provider.ts` —
  WebDriverAgent `/source` reader (iOS).
- `src/testorbit/infrastructure/flutter-tree-reader.ts` — Patrol
  semantics-dump file reader (Flutter).

## Deferred: non-Android handler providers in the recording path

**Status (Phase 9): deferred work, documented — not wired here.**

The tree readers for the other platforms exist:
`IosHierarchyProvider` reads WebDriverAgent's `/source` JSON, and
the Flutter tree reader converts a Patrol semantics dump
(`integration_test/testorbit_tree_dump_test.dart`, run with
`patrol test`) to the core hierarchy shape. `RecordingDetector`
itself is provider-agnostic — it takes any `HierarchyProvider`.

But the live recording path does not wire them in: the MCP
recording path (`recording-probe.ts`) constructs only
`AndroidHierarchyProvider`, and there is no iOS (WDA) or Flutter
(Patrol) recording handler — no device/session selection, no
live dump source, no display-size source for those platforms in
the record flow.

**Recommended resolution (follow-up, Phase 7 pilot work):** wire
one recording handler per platform — WDA-backed for iOS,
Patrol-dump-backed for Flutter — behind the same
`HierarchyProvider` interface the detector already takes, so the
record path stays provider-agnostic. The iOS and Flutter pilots
need this before their flows can be recorded; it is not a
Phase 9 change because there is no pilot app or device to prove
it against yet. Owner: the Phase 7 pilot work.
