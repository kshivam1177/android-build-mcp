# Persistent testing knowledge

The `refresh_test_knowledge` tool builds or refreshes `.testorbit/test-knowledge.json`.

It indexes metadata for saved test cases, custom instructions, learned screens, recordings/action sequences, workflows, and test reports. It stores file paths, content hashes, sizes, modification times, and asset types—not copies of the underlying instructions or test-case contents.

Each refresh reports:
- assets added, changed, or removed since the previous refresh;
- test cases whose explicit source mappings match current Git changes;
- recent reports that explicitly record failed steps;
- malformed or unavailable inputs as warnings.

Test cases are considered stale only when their explicit file/module mappings match a Git change. Missing mappings are not guessed. The tool does not execute tests, modify saved cases, rewrite instructions, or infer a passing result. If the Git base is unavailable, the inventory still refreshes and includes a warning.

The manifest itself is excluded from its own asset inventory. Binary screenshots are not hashed or indexed.
