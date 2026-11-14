# Screenshot OCR and coordinate analysis

TestOrbit exposes `analyze_screenshot` and `fill_form` in the `ui-automation` workflow. `fill_form` is ported from the dev branch and resolves fields by semantic selectors, failing safely when a selector is missing or ambiguous. It captures the selected Android target's screenshot, runs local Tesseract OCR, and returns text with pixel-space bounding boxes and center points as JSON.

## Requirements

Install Tesseract OCR separately and make its executable available on `PATH`. If it is installed in a non-standard location, set `TESSERACT_PATH` to the executable path. The default language is English (`eng`); other language codes require their Tesseract language data to be installed.

- macOS: `brew install tesseract`
- Debian/Ubuntu: `sudo apt-get install tesseract-ocr`
- Windows: install a trusted Tesseract OCR distribution and add its installation directory to `PATH`, or set `TESSERACT_PATH`.

The MCP server does not download language models at runtime and does not save screenshots to temporary files. Screenshot bytes are streamed to the local OCR process.

## Example MCP call

```json
{
  "targetId": "emulator-5554",
  "language": "eng",
  "minConfidence": 40,
  "mode": "line"
}
```

## Example result

```json
{
  "targetId": "emulator-5554",
  "backend": "adb",
  "mimeType": "image/png",
  "coordinateSpace": "screenshot-pixels",
  "engine": "tesseract",
  "language": "eng",
  "width": 1080,
  "height": 2400,
  "elements": [
    {
      "text": "Sign In",
      "confidence": 92.4,
      "bounds": { "left": 380, "top": 1010, "right": 700, "bottom": 1070 },
      "center": { "x": 540, "y": 1040 }
    }
  ]
}
```

The values above are illustrative. `bounds` uses left/top-inclusive and right/bottom-exclusive pixel coordinates; `center` is the suggested tap point. `mode: "word"` returns separate OCR words instead of grouped text lines. `minConfidence` filters low-confidence words before grouping. OCR is approximate and primarily detects text; it cannot reliably identify icons, unlabeled controls, or the semantic role of every element.

## Use OCR together with semantic UI snapshots

For robust automation, prefer `snapshot_ui` first. It reads Android's accessibility/UI hierarchy and returns semantic element references and device bounds. Use `analyze_screenshot` when visible text is missing from the hierarchy or when you specifically need screenshot-derived text boxes. OCR coordinates can be passed to `tap`, but refresh the screenshot after navigation or layout changes.

## Safety and resource limits

- OCR runs locally; the screenshot is not sent to a hosted service.
- The subprocess is started without a shell and screenshot bytes are sent over stdin.
- OCR has a configurable timeout (1–120 seconds) and a 16 MiB output cap.
- The tool is read-only. It does not tap, type, or otherwise mutate the app.
