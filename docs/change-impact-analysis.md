# Change-impact analysis

The `analyze_changes` MCP tool inspects committed and working-tree changes, recommends test suites by file type, and maps changed files to saved test cases.

## Explicit test-case mappings

Add one or more optional string-array fields to a test case JSON file in `.testorbit/testcases/`:

- `relatedFiles`
- `affectedPaths`
- `sourceFiles`
- `files`
- `paths`
- `modules`

Examples:

```json
{
  "id": "login-smoke",
  "title": "Login smoke test",
  "category": "smoke",
  "relatedFiles": ["lib/login.dart", "lib/auth/**"]
}
```

Exact paths and directory prefixes are supported. A trailing `/**` or `*` can match descendants/prefixes. A test is selected only when a declared path matches a changed file. Similar test names or categories are not treated as proof of coverage.

## Conservative behavior

The analysis returns selected test cases, matched paths, unmapped changed files, whether explicit mappings exist, and whether broad regression is required. Broad regression is recommended if changes have no mapping, no test cases exist, no explicit mappings are available, or no changed files were provided. This tool recommends tests; it does not execute them or guarantee coverage.

Malformed test-case JSON files are reported in `invalidTestCaseFiles` rather than silently counted as valid tests.
