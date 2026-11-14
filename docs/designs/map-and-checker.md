# Screen map, checker, and rename

Phase 6 of the TestOrbit plan. The plan of record is
`~/workspace/test-automation-mcp/testorbit-final-implementation-plan.md`
(Part B B7/B12/C3/C16, D11); this doc is the design summary the
drift report reads — it does not replace the plan.

## Screen map (`screen-map.json`)

One map per platform (`<platform>/screen-map.json`,
`schemaVersion: 2`): the learned screens (the index) plus edges
from `(screen, variant)` to `(screen, variant)`, each backed by
the recordings that prove the transition. The map is per platform
because the same logical screen can have different elements on
Android and iOS — one shared map would mix them.

- `src/testorbit/application/generate-map.ts` reads
  `<platform>/screens/` (bases + variants) and
  `<platform>/recordings/` (schema v2, via the one shared
  `recording-reader.ts`) and writes the map. An edge exists where
  a recording's navigation steps prove a transition: the action
  that changed the matched `(screen, variant)` carries the
  from-pair, the action type, and the element id, and the next
  action carries the to-pair. v1 recordings carry no ids and
  yield no edges ("unproven / start-stop only").
- The map's `coverage` block reports: screens learned, variants
  learned, edge count, screens never traversed, variants never
  traversed. Phase 9 copies this block into the run report (see
  `measurement-model.md`).
- **The map is a discovery/coverage aid, never a runner gate:**
  a missing edge is a warning; a dangling edge fails
  `check-screen-map`.

## Stale edges (C3/C16)

An edge whose `to` screen was re-learned since its proving
recording is marked stale until a newer recording re-proves it.
Re-learn is detected two ways: the `to` variant's `learnedAt`
is newer than the recording's `stoppedAt`, or the `to` screen's
`elements.json` mtime is newer than the recording file's mtime.
The generator never silently remaps ids across a split/merge —
edges are derived only from recorded ids.

## Checker (`check-screen-map`)

`src/testorbit/application/check-map.ts` (split into
`check-map-screen.ts`, `check-map-entries.ts`,
`check-map-migration.ts` to meet the Part D file caps). It fails on:

- a dangling edge (an edge pointing at a deleted screen);
- a screen folder with no map entry;
- a fingerprint changed without re-learning;
- a split/merge without an element-id migration list (see
  `screen-split-merge-migration.md`);
- a re-learned `to` screen whose incoming edges are not
  re-proved (stale edges).

It warns (never fails) on a missing edge. It reports per-screen
variant counts and "learned, never traversed" screens, and
per-screen scope coverage (`stableCoveragePct` — the B3 ≥80%
rule: interactive elements carrying a `resourceId` or a unique
`contentDesc`). It enforces the variant-count guardrail (flag
>5, fail >10) and the value-change rejection.

## Rename (`rename-screen`)

`src/testorbit/application/rename-screen.ts` renames a screen id
and rewrites **all** references — folder, `screen.json`, every
YAML/JSON test, every edge, **and every `screenId`/`variantId`
in `recordings/`** — then regenerates the map. Verify by
regenerating after a rename and confirming no edge references
the old id.

## Code

- `src/testorbit/domain/screen-map.ts` — map, edge, coverage,
  checker-report, and migration-list schemas.
- `src/testorbit/application/generate-map.ts`,
  `src/testorbit/application/check-map.ts` (+ split files),
  `src/testorbit/application/rename-screen.ts`,
  `src/testorbit/application/screen-references.ts` (rename
  string-rewriting helpers).
- `src/testorbit/core/scope-coverage.ts` — the B3 ≥80% scope rule.
- `src/testorbit/core/migration-check.ts` — split/merge migration
  list enforcement.
