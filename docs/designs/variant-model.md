# Variant model

Phase 2 of the TestOrbit plan. The plan of record is
`~/workspace/test-automation-mcp/testorbit-final-implementation-plan.md`
(Part B, B2/B4/D8/D9); this doc is the design summary the drift
report reads — it does not replace the plan.

## The model

A **logical screen** is one screen of the app as the user sees it
(`screens/<screenId>/`). Its **base** (`elements.json`) lists the
screen's shared elements with one stable selector each. A
**variant** (`variants/<variantId>.json`) is one state of that
screen, defined by three element sets:

- `required` — elements that must be present for the variant to match.
- `optional` — elements that may be present; they never decide a
  match on their own.
- `excluded` — elements that must be absent for the variant to match.

Every screen has a `default` variant whose `required` is a
**designated subset** of the base screen's shared elements — the
elements that define the screen (its title, its primary action) —
and whose `excluded` is empty. See [Open gap](#open-gap-default-variant-designated-required-subset)
below: the designation is not yet wired through the host-agent learn
path.

## Match rule (B4)

A screen matches a variant when **all three** hold:

1. All `required` elements are present (present means present
   *and* enabled as learned — a `changed` required element fails).
2. All `excluded` elements are absent.
3. At most 10% of the variant's **non-required** stable elements
   are missing or added, summed against one budget:
   `missing + added ≤ floor(0.10 × n)`, where `n` counts
   non-required elements (`optional` + shared base elements not in
   `required`). A 5-element variant tolerates 0 additions/removals.

Text changes on stable elements and bounds movement are warnings.
Element-count drift ≤10% is a warning; above 10% it fails clause
(iii). A `changed` element on a non-required element is a warning
and does not count toward the clause (iii) budget.

## Detection precedence

Most-specific variant first, `default` last, `unknown` only if no
variant — including `default` — matches. A `default` with an empty
required set would match everything and disable unknown-variant
detection, so it is forbidden (the learner rejects it).

## Where `excluded` comes from (D9)

`excluded` elements cannot be derived from the elements just
learned (they are absent by definition). `excluded` = (elements of
all other variant files of the same logical screen, read directly
from `screens/<screenId>/variants/*.json`) minus (elements present
now). The universe is the variant files themselves — **not**
`screen-map.json`, which is only generated in Phase 6. The first
variant learned for a screen has an empty `excluded` list; it is
backfilled when the second variant is learned, and the map is
regenerated.

## Guardrails

- Variant-count guardrail: flag >5 variants on one screen, fail
  >10 (usually means two logical screens were merged into one).
- Value-change rule: a variant whose required+excluded sets are
  identical to an existing variant of the same screen is rejected
  — variants must differ by value, not just by name.
- Stable identity: element ids are prefixed with the screen id
  (B3); a split/merge needs an explicit element-id migration list
  (`screen-split-merge-migration.md`).

## Code

- `src/testorbit/application/learn-screen.ts` — variant learning
  (writes `variants/<variantId>.json`, derives `excluded`, enforces
  the guardrails).
- `src/testorbit/application/detect-variant.ts` — detection against a
  fresh hierarchy dump.
- `src/testorbit/core/variant-match.ts`, `src/testorbit/core/matcher.ts`
  — the pure match rule.
- `src/testorbit/core/fingerprint.ts` — fingerprint v2 (a version
  stamp only, never a run-time check).

## Open gap: `default` variant designated-required subset

**Status (Phase 9): open, documented — not silently changed.**

B2 requires the `default` variant's `required` to be a designated
subset of the screen's shared elements, recorded at learn time.
The learner already accepts the designation: `LearnScreenUseCase`
takes an optional `requiredIds` input (`learn-screen.ts`), and the
CLI exposes it as `orbit learn --required <id,...>`. But the
host-agent learn path does not pass one: `orbit_learn_screen`
(`src/tools/ui-automation/orbit_learn_screen.ts`) learns `default` with
no designated subset, so the use-case default applies and
`required` becomes **every interactive id present** (see the
comment at `orbit_learn_screen.ts:127-130`).

**Why it matters:** a shared element that is only sometimes
present (e.g. a promo-banner button) in `required` makes `default`
fail whenever that element is absent, and the screen is reported
`unknown` even though it is the screen's base state.

**Recommended fix (follow-up, not Phase 9):** add an optional
designated-required input to the `orbit_learn_screen` MCP tool — the host
agent designates the defining elements (title, primary action) at
learn time and passes them as `requiredIds`. No use-case or CLI
change is needed; both already accept the input. Owner: whoever
owns the host-agent `orbit_learn_screen` tool. Until then, screens whose
`default` was learned with all-interactive required sets should be
re-learned with `--required` once the tool input exists.
