# Screen splits and merges — the element-id migration-list rule

Phase 3 task 3 of the TestOrbit plan. Enforcement lands in Phase 6
(`check-screen-map`); this document is the rule the checker enforces.

## The rule

When a logical screen **splits** into two screens, or two screens
**merge** into one, element ids change: ids are prefixed with the screen
id (B3), so `checkout.pay-now` becomes `checkout-payment.pay-now` after
a split, and two merged screens' ids collide or get re-prefixed. That
change is only safe with an **explicit element-id migration list**.
Without one, `check-screen-map` fails.

A migration list is a human statement that "old id X is now new id Y"
(or "old id X is gone"). The learn diff (`core/screen-diff.ts`) is
evidence, not a substitute: a rename in the diff says two ids share a
selector, but only the migration list says the rename is intended and
which old tests, recordings, and variant files the new id now satisfies.

## Format

One file per split/merge, next to the affected screen(s):

`screens/<screenId>/migrations/<migration-name>.json`, `schemaVersion: 2`:

```json
{
  "schemaVersion": 2,
  "migration": "checkout-split-2026-11-13",
  "reason": "Checkout grew a separate payment step; payment elements move to checkout-payment.",
  "fromScreen": "checkout",
  "toScreens": ["checkout", "checkout-payment"],
  "mappings": [
    { "from": "checkout.pay-now", "to": "checkout-payment.pay-now" },
    { "from": "checkout.card-number", "to": "checkout-payment.card-number" }
  ],
  "removed": ["checkout.promo-banner"],
  "createdAt": "2026-11-13T10:00:00Z"
}
```

- `mappings` — every element id that survives under a new id. An id
  that survives with no entry is an error: the checker cannot tell a
  deliberate rename from a lost element.
- `removed` — ids that deliberately have no successor (the element is
  gone from the app). An id that disappears with no mapping and no
  `removed` entry fails the check.
- `fromScreen` / `toScreens` — the split/merge direction, so the
  checker knows which screens' files the list covers.

## What the checker does (Phase 6)

`check-screen-map` compares the learned screens against the migration
lists:

1. Every element id that disappears from a screen between learns must
   appear either in a `mappings` entry (`from`) or in `removed`.
2. Every `mappings` entry's `to` id must exist in the target screen's
   `elements.json`; every `from` id must no longer exist there.
3. A split/merge with no migration list file fails, naming the
   disappeared ids.

Until Phase 6 lands, no checker enforces this — the rule is recorded
here so splits and merges done in the meantime still write the list.
