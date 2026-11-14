# `infrastructure/` — adapters behind interfaces

Swappable, mockable adapters for everything outside pure logic:
the filesystem, hierarchy sources (adb, WebDriverAgent, Patrol
dumps), the Maestro subprocess, the variant store, and the one
shared recording reader.

## Layer rule

`infrastructure/` may import `core/`, `domain/`, and
`infrastructure/`. Adapters depend on interfaces the
`application/` layer defines where one exists (e.g.
`HierarchyProvider`); the `application/` layer never imports an
adapter's concrete class except at construction time in the CLI
or the MCP tool that wires it.

## What lives here

- `filesystem.ts` — all file reads/writes (atomic write +
  backup); `getPlatformDir` is the one path resolver.
- `hierarchy-provider.ts` — Android (adb) hierarchy provider.
- `ios-hierarchy-provider.ts` — WebDriverAgent `/source` reader.
- `flutter-tree-reader.ts` — Patrol semantics-dump file reader.
- `maestro-runner.ts` — runs `maestro test`, parses its report.
- `variant-store.ts` — reads/writes learned screens + variants.
- `recording-reader.ts` — the one shared v1+v2 recording reader.

## How to test it

Co-located tests (`<source>.test.ts`), run with `npm test`.
Adapter tests use temp directories and fixture files; live
device checks (adb, WDA) are out of scope for unit tests and
belong to the pilot proofs.
