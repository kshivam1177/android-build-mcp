# `config/` — TestOrbit configuration (reserved)

Reserved for the single TestOrbit config file (`config.ts`,
Zod-validated; `doctor` validates it) from the plan's Part D
layout. **Empty as of Phase 9** — no config file exists yet,
because no pilot project has needed one: every tool and CLI
command currently takes the platform from `--platform` (or
config, when it lands), and all paths resolve through
`getPlatformDir` in `infrastructure/filesystem.ts`.

## Layer rule

`config/` may import `domain/` and `config/` only. When
`config.ts` lands here, it validates with Zod at the parse
boundary like every other `domain/` schema, and nothing outside
`cli/` and `application/` construction reads it directly.

## How to test it

Co-located tests (`<source>.test.ts`), run with `npm test`,
once a config file exists.
