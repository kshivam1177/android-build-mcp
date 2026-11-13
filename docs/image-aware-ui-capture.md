# Image-aware UI capture

The `analyze_screen_image` MCP tool combines an Android screenshot with the semantic UI hierarchy so agents can associate visible text with existing `elementRef` values and element bounds.

## What it returns

- A screenshot attached to the MCP response and saved under `.testorbit/artifacts/screenshots/`.
- A JSON report under `.testorbit/artifacts/image-analysis/`.
- Semantic elements with bounds, enabled/clickable state, resource IDs, accessibility descriptions, and OCR text.
- OCR word bounds and confidence, with an optional `matchedElementRef` when a word falls inside a semantic element's bounds.
- Warnings if optional image processing or OCR dependencies are missing.

## Optional image/OCR dependencies

The framework does not require these dependencies to install or start.

- **Sharp** is used when installed to rotate, grayscale, normalize contrast, resize, and prepare screenshots for OCR. Install it in the environment running the MCP server with `npm install sharp` (or install it as an optional dependency in your own deployment).
- **Tesseract OCR** must be installed separately and available on `PATH`. Pass `tesseractPath` to the tool if the executable is not on `PATH`.

Without Sharp, the tool still attempts OCR on the original screenshot. Without Tesseract, semantic hierarchy capture and screenshot artifacts still work, and the report contains a warning rather than failing the whole capture.

## MCP tool inputs

- `targetId`: optional connected device serial; normal session target resolution applies.
- `projectPath`: optional project root for artifacts.
- `minConfidence`: OCR confidence threshold from 0 to 100 (default 45).
- `tesseractPath`: optional Tesseract executable path.
- `timeoutMs`: OCR timeout (default 15000 ms; allowed 1000–60000 ms).

OCR coordinates are scaled back to the original screenshot dimensions after preprocessing. When multiple semantic nodes contain a word's center, it is associated with the smallest containing node to prefer a specific control over a broad parent container. OCR matching is best-effort and should not replace selector uniqueness checks or post-action assertions.

## Validation

The unit tests cover TSV parsing, coordinate scaling, confidence filtering, and matching OCR words to the smallest containing semantic node. A connected-device smoke test is still needed to validate real screenshots, device-specific OCR, and element matching end to end.
