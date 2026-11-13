import analyzeTestProject from './analyze_test_project.js';
import saveTestInstructions from './save_test_instructions.js';
import writeTestReport from './write_test_report.js';
import saveTestCase from './save_test_case.js';
import convertRecording from './orbit_convert_recording.js';
import copyTestCase from './orbit_copy_test_case.js';
import listTestCases from './list_test_cases.js';
import auditScreen from './audit_screen.js';
import runTestCase from './run_test_case.js';
import analyzeChanges from './analyze_changes.js';
import resolveTestInstructions from './resolve_test_instructions.js';
import validateTestPlan from './validate_test_plan.js';
import refreshTestKnowledge from './refresh_test_knowledge.js';
import planTestRun from './plan_test_run.js';
import consolidateTestReports from './consolidate_test_reports.js';
import runTestWorkflow from './run_test_workflow.js';
import validateTestEnvironment from './validate_test_environment.js';
import runProjectTests from './run_project_tests.js';
import generateTestCandidate from './generate_test_candidate.js';
import aggregateTestEvidence from './aggregate_test_evidence.js';
import evaluateTestGate from './evaluate_test_gate.js';
import planIntelligentTests from './plan_intelligent_tests.js';
import diagnoseTestFailures from './diagnose_test_failures.js';
import proposeSelectorRepairs from './propose_selector_repairs.js';
import runAutonomousTestCycle from './run_autonomous_test_cycle.js';
import analyzeTestQuality from './analyze_test_quality.js';
import evaluateTestQualityGate from './evaluate_test_quality_gate.js';
import runTestSuiteMatrix from './run_test_suite_matrix.js';
import validateTestEvidenceBundle from './validate_test_evidence_bundle.js';
import runUnifiedTestRun from './run_unified_test_run.js';
import inspectTestRuntime from './inspect_test_runtime.js';
import planChangeAwareTestRun from './plan_change_aware_test_run.js';
import reviewTestCandidate from './review_test_candidate.js';
import prepareChangeAwareExecutionPlan from './prepare_change_aware_execution_plan.js';
import approveSelectorRepair from './approve_selector_repair.js';
import type { ToolModule } from '../types.js';

export const testingIntelligenceTools: ToolModule[] = [
  analyzeTestProject, saveTestInstructions, writeTestReport, saveTestCase, convertRecording, copyTestCase, listTestCases,
  auditScreen, runTestCase, analyzeChanges, resolveTestInstructions, validateTestPlan,
  refreshTestKnowledge, planTestRun, consolidateTestReports, runTestWorkflow,
  validateTestEnvironment, runProjectTests, generateTestCandidate, aggregateTestEvidence, evaluateTestGate,
  planIntelligentTests, diagnoseTestFailures, proposeSelectorRepairs, runAutonomousTestCycle, analyzeTestQuality, evaluateTestQualityGate, runTestSuiteMatrix, validateTestEvidenceBundle, runUnifiedTestRun, inspectTestRuntime, planChangeAwareTestRun, reviewTestCandidate, prepareChangeAwareExecutionPlan, approveSelectorRepair,
];
