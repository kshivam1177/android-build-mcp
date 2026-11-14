import snapshotUi from './snapshot_ui.js';
import tap from './tap.js';
import tapText from './tap_text.js';
import clearAndTypeText from './clear_and_type_text.js';
import isKeyboardVisible from './is_keyboard_visible.js';
import longPress from './long_press.js';
import swipe from './swipe.js';
import drag from './drag.js';
import typeText from './type_text.js';
import keyPress from './key_press.js';
import hideKeyboard from './hide_keyboard.js';
import button from './button.js';
import gesture from './gesture.js';
import screenshot from './screenshot.js';
import analyzeScreenImage from './analyze_screen_image.js';
import saveScreenMap from './save_screen_map.js';
import analyzeScreenshot from './analyze_screenshot.js';
import fillForm from './fill_form.js';
import runUiWorkflow from './run_ui_workflow.js';
import waitForUi from './wait_for_ui.js';
import batch from './batch.js';
import touch from './touch.js';
import learnScreen from './orbit_learn_screen.js';
import interactScreen from './interact_screen.js';
import startRecording from './orbit_start_recording.js';
import stopRecording from './orbit_stop_recording.js';
import replayRecording from './orbit_replay_recording.js';
import detectVariant from './orbit_detect_variant.js';
import type { ToolModule } from '../types.js';

export const uiAutomationTools: ToolModule[] = [
  snapshotUi,
  tap,
  tapText,
  clearAndTypeText,
  isKeyboardVisible,
  longPress,
  swipe,
  drag,
  typeText,
  keyPress,
  hideKeyboard,
  button,
  gesture,
  screenshot,
  analyzeScreenImage,
  saveScreenMap,
  analyzeScreenshot,
  fillForm,
  runUiWorkflow,
  waitForUi,
  batch,
  touch,
  learnScreen,
  interactScreen,
  detectVariant,
  startRecording,
  stopRecording,
  replayRecording,
];
