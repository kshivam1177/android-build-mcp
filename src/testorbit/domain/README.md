# `domain/` — branded types, schemas, errors

The shared vocabulary every layer speaks: branded ids
(`ScreenId`, `VariantId`, `ElementId`, `TestId`), platforms,
and the Zod schemas that validate everything crossing a
boundary — canonical test cases, run reports, failure bundles,
recordings, screen maps, Maestro YAML.

## Layer rule

`domain/` imports only `domain/`. Schemas parse untrusted input
and throw typed errors (`errors.ts`); they never touch the
filesystem, a device, or a subprocess.

## What lives here

- `types.ts` — branded types + `Platform` + hierarchy node types.
- `errors.ts` — `TestOrbitError` and friends.
- `testcase-schemas.ts` — canonical test case, run report
  (incl. the Phase 9 coverage block), failure bundle.
- `recording-schemas.ts` — recording documents v1 + v2.
- `screen-map.ts` — screen map, edges, coverage, checker report,
  migration lists.
- `maestro-schema.ts`, `schemas.ts` — Maestro YAML + shared schemas.

## How to test it

Co-located tests (`<source>.test.ts`), run with `npm test`.
Schema tests assert the v2 shape parses, unknown versions are
rejected, and invalid shapes name the failing field.
