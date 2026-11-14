# TestOrbit pilot trees

One folder per pilot app lives here, created when the pilot app is named
(at testing time, on the user's computer). Each pilot tree is platform-wise
and lives inside the project folder only:

```
examples/testorbit-pilot/<app>/.testorbit/
  android/    # Android screens, recordings, test cases, generated YAML, reports
  ios/        # same, for iOS (Maestro + WebDriverAgent)
  flutter/    # same, for Flutter (Patrol tree, Maestro replay)
  web/        # same, for web (Playwright tests)
```

Each platform folder holds `screens/`, `recordings/`, `testcases/`, `tests/`,
`test-reports/`, and one `screen-map.json` (generated in Phase 6).

## No flows are shipped here

Test flows come only from recording the actual flow of a real app, once
the codebase is ready, at testing time, on the user's apps. No hardcoded
test flow, canned flow, or demo flow is baked into TestOrbit or stored here.
Unit-test fixtures for the pure logic (element id, matcher, fingerprint,
converter) live in `src/testorbit/test-fixtures/` — they are test data, never
pretend flows and never shipped as example tests.
