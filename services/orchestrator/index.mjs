/**
 * The headless orchestrator, phase v09.
 *
 * Import surface only. The behaviour lives in the modules named below so that a reviewer reads
 * one concern at a time:
 *
 *   goal.mjs      plain language -> a structured, checkable goal (+ the assumption log)
 *   planner.mjs   goal -> a deterministic plan, replayed against the graph rules before use
 *   executor.mjs  the bounded experiment loop; every mutation goes through the tool bus
 *   verdict.mjs   measured number vs goal, with a trial id or NOT_MEASURED
 *   report.mjs    the BuildReport a human receives, and its rendering
 *   budget.mjs    every bound, enforced in exactly one place
 */

export { Budget, BudgetExhausted, DEFAULT_BUDGET } from './budget.mjs';
export { DOMAINS, GoalNotMeasurable, parseGoal } from './goal.mjs';
export { ACTIONS, classify, execute } from './executor.mjs';
export { LANES, planGoal, replayPlan } from './planner.mjs';
export { REASONS, judge, judgeAll, statusFor } from './verdict.mjs';
export { buildReport, renderReport } from './report.mjs';
export { runOrchestrator } from './runner.mjs';