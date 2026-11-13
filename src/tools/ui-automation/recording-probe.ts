/**
 * Recording probe glue (Phase 5, B8) — the thin tools-side seam between
 * the UI-automation handlers and the TestOrbit `RecordingDetector`.
 *
 * Each handler that performs a recorded action calls
 * `startRecordingProbe()` before the action (one fresh hierarchy dump +
 * identification) and `finishRecordingProbe()` after it (second dump,
 * navigation comparison, element resolution, `recordAction()`). When no
 * recording is active the probe is inert and touches no device.
 *
 * Platform note: only Android has a hierarchy provider in the handler
 * path today (`AutomationBackend` is ADB-only). A recording on another
 * platform still records every action — without screen/variant info and
 * with an explicit note saying why, never a pretended detection.
 */
import type { AutomationBackend } from '../../automation/backend.js';
import { getRecordingInfo, isRecording, recordAction } from '../../automation/recorder.js';
import type { RecordedAction } from '../../automation/recorder.js';
import { DetectVariantUseCase } from '../../testorbit/application/detect-variant.js';
import { RecordingDetector } from '../../testorbit/application/record-action.js';
import type { RecordDetection } from '../../testorbit/application/record-action.js';
import type { StableSelector } from '../../testorbit/domain/types.js';
import { AndroidHierarchyProvider } from '../../testorbit/infrastructure/hierarchy-provider.js';
import { VariantStore } from '../../testorbit/infrastructure/variant-store.js';
import { dumpHierarchyWithRetry, getScreenSize } from './_shared.js';

/** Pre-action probe state carried across one handler action. */
export interface RecordingProbe {
  detector: RecordingDetector | null;
  before: RecordDetection | null;
  /** Why detection is unavailable for this recording, when it is. */
  unavailableReason?: string;
}

/**
 * Start a recording probe for one action: when a recording is active,
 * build the detector for the recording's platform and capture the
 * pre-action detection. Never throws; a failed pre-action dump is
 * reported by the detector as `unavailable`, not raised.
 *
 * @param backend - Automation backend that owns the device.
 * @param targetId - Target device id the action runs on.
 * @returns The probe to pass to `finishRecordingProbe` after the action.
 */
export async function startRecordingProbe(
  backend: AutomationBackend,
  targetId: string,
): Promise<RecordingProbe> {
  const info = getRecordingInfo();
  if (info === null || !isRecording(targetId)) return { detector: null, before: null };
  if (info.platform !== 'android') {
    return {
      detector: null,
      before: null,
      unavailableReason:
        `screen detection is not wired for platform "${info.platform}": ` +
        'no hierarchy provider in the handler path, so the action is recorded without screen/variant info',
    };
  }
  const provider = new AndroidHierarchyProvider(
    () => dumpHierarchyWithRetry(backend, targetId),
    () => getScreenSize(targetId),
  );
  const store = new VariantStore(info.projectRoot, info.platform);
  const detector = new RecordingDetector({
    useCase: new DetectVariantUseCase(store),
    provider,
    store,
    projectRoot: info.projectRoot,
    platform: info.platform,
  });
  return { detector, before: await detector.detectCurrent() };
}

/**
 * Finish a recording probe after the action: annotate it from the
 * pre/post detections and append it to the active recording. No-op
 * when no recording is active.
 *
 * @param probe - Probe from `startRecordingProbe`, before the action.
 * @param targetId - Target device id the action ran on.
 * @param action - Recorded action fields (without id / timestamp).
 * @param selector - Stable-selector fields of the acted-on element,
 *   when the action targeted one.
 */
export async function finishRecordingProbe(
  probe: RecordingProbe,
  targetId: string,
  action: Omit<RecordedAction, 'id' | 'timestamp'>,
  selector?: StableSelector,
): Promise<void> {
  if (!isRecording(targetId)) return;
  if (probe.detector !== null && probe.before !== null) {
    const annotation = await probe.detector.annotateAction(probe.before, selector);
    recordAction({ ...action, ...annotation });
    return;
  }
  if (probe.unavailableReason !== undefined) {
    recordAction({ ...action, isNavigationStep: false, detectionNote: probe.unavailableReason });
    return;
  }
  if (probe.detector !== null) {
    recordAction({ ...action, isNavigationStep: false, detectionNote: 'pre-action detection was not captured.' });
    return;
  }
  recordAction(action);
}
