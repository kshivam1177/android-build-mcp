import validateCrossPlatformTest from './validate_cross_platform_test.js';
import runCrossPlatformTest from './run_cross_platform_test.js';
import inspectCrossPlatformTarget from './inspect_cross_platform_target.js';
import diagnoseCrossPlatformFailure from './diagnose_cross_platform_failure.js';
import checkCrossPlatformRuntime from './check_cross_platform_runtime.js';
import manageIosSimulator from './manage_ios_simulator.js';

export const crossPlatformAutomationTools = [
  validateCrossPlatformTest,
  runCrossPlatformTest,
  inspectCrossPlatformTarget,
  diagnoseCrossPlatformFailure,
  checkCrossPlatformRuntime,
  manageIosSimulator
];
export { validateCrossPlatformTest, runCrossPlatformTest, inspectCrossPlatformTarget, diagnoseCrossPlatformFailure, checkCrossPlatformRuntime, manageIosSimulator };
