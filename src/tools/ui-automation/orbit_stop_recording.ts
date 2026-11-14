import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getRecordingInfo, saveRecordingScreenshot, stopRecording } from '../../automation/recorder.js';
import { withErrorHandling, textResult } from '../../utils/response.js';
import { resolveTargetAndBackend } from './_shared.js';
import type { ToolModule } from '../types.js';

export const toolName = 'orbit_stop_recording';
export const workflow = 'ui-automation';

export function register(server: McpServer) {
  return server.registerTool(toolName, {
    title: 'Stop UI Recording',
    description: 'Stop the active UI recording and persist its actions and start/stop screenshots under .testorbit/. Replay it later with orbit_replay_recording.',
    inputSchema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, withErrorHandling(async () => {
    const info = getRecordingInfo();
    if (!info) throw new Error('No recording is active. Call orbit_start_recording first.');
    try {
      const { backend } = await resolveTargetAndBackend(info.deviceId);
      const screenshot = await backend.screenshot(info.deviceId);
      await saveRecordingScreenshot('stop', screenshot.data);
    } catch {
      // Keep the action log even when final screenshot capture is unavailable.
    }
    const result = await stopRecording();
    return textResult(`Saved recording "${result.flowId}" with ${result.actionCount} actions.`, result);
  }));
}

const mod: ToolModule = { toolName, workflow, register };
export default mod;
