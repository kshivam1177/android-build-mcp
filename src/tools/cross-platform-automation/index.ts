import validateCrossPlatformTest from './validate_cross_platform_test.js';
import runCrossPlatformTest from './run_cross_platform_test.js';
import runCrossPlatformSuite from './run_cross_platform_suite.js';
import inspectCrossPlatformTarget from './inspect_cross_platform_target.js';
import diagnoseCrossPlatformFailure from './diagnose_cross_platform_failure.js';
import checkCrossPlatformRuntime from './check_cross_platform_runtime.js';
import manageIosSimulator from './manage_ios_simulator.js';
import manageCrossPlatformFleet from './manage_cross_platform_fleet.js';
import validateCrossPlatformEvidence from './validate_cross_platform_evidence.js';

export const crossPlatformAutomationTools = [
  validateCrossPlatformTest,
  runCrossPlatformTest,
  runCrossPlatformSuite,
  inspectCrossPlatformTarget,
  diagnoseCrossPlatformFailure,
  checkCrossPlatformRuntime,
  manageIosSimulator,
  manageCrossPlatformFleet,
  validateCrossPlatformEvidence
];
export { validateCrossPlatformTest, runCrossPlatformTest, runCrossPlatformSuite, inspectCrossPlatformTarget, diagnoseCrossPlatformFailure, checkCrossPlatformRuntime, manageIosSimulator, manageCrossPlatformFleet, validateCrossPlatformEvidence };
