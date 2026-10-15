import { randomUUID } from 'node:crypto';
import { canonicalHash, canonicalStringify, clone } from '../graph/canonical.mjs';
import { loadContracts, loadKinds } from '../graph/contracts.mjs';

const MAX_PARALLEL_RUNS = 1;

export async function runTrial(graph, goal, parameters, envOverrides, seed, services) {
  validateServices(services);
  validateInputs(graph, goal, parameters, envOverrides, seed);

  const contracts = loadContracts();
  const repeats = services.repeats ?? 1;
  if (!Number.isInteger(repeats) || repeats < 1) throw new RangeError('Trial repeats must be a positive integer.');
  const maximumRuns = contracts.capability?.limits?.max_trial_runs ?? 64;
  if (!Number.isInteger(maximumRuns) || maximumRuns < 1) {
    throw new TypeError('Capability max_trial_runs must be a positive integer.');
  }
  const combinations = parameterCombinations(graph, parameters, Math.floor(maximumRuns / repeats));
  const runCount = combinations.length * repeats;
  if (runCount > maximumRuns) {
    throw new RangeError(`Trial has ${runCount} runs, exceeding capability limit ${maximumRuns}.`);
  }
  if (!Number.isSafeInteger(seed + runCount - 1)) {
    throw new RangeError('Trial run seeds exceed the safe integer range.');
  }

  const baseGraph = clone(graph);
  if (Object.keys(envOverrides ?? {}).length) {
    if (typeof services.applyEnvironmentOverrides !== 'function') {
      throw new TypeError('Trial environment overrides require applyEnvironmentOverrides(graph, overrides).');
    }
    await services.applyEnvironmentOverrides(baseGraph, clone(envOverrides));
  }
  const maximumNodes = contracts.capability?.limits?.max_nodes;
  if (Number.isInteger(maximumNodes) && baseGraph.nodes.length > maximumNodes) {
    throw new RangeError(`Trial graph has ${baseGraph.nodes.length} nodes, exceeding capability limit ${maximumNodes}.`);
  }
  const maximumPayloadBytes = contracts.capability?.limits?.max_payload_bytes;
  const payloadBytes = Buffer.byteLength(canonicalStringify({ graph: baseGraph, environment_overrides: envOverrides ?? {} }));
  if (Number.isInteger(maximumPayloadBytes) && payloadBytes > maximumPayloadBytes) {
    throw new RangeError(`Trial graph payload has ${payloadBytes} bytes, exceeding capability limit ${maximumPayloadBytes}.`);
  }
  const graphRevision = baseGraph.revision;
  const graphHash = await canonicalHash(baseGraph);
  const trialId = services.id?.() ?? randomUUID();
  if (typeof trialId !== 'string' || !/^[A-Za-z0-9_-]{1,110}$/.test(trialId)) {
    throw new TypeError('Trial id must contain 1 to 110 letters, digits, underscores, or hyphens.');
  }
  const startedAt = services.clock.now();
  const runs = [];
  let cancelled = false;

  outer: for (const combination of combinations) {
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      const index = runs.length;
      if (isCancelled(services)) {
        cancelled = true;
        break outer;
      }
      runs.push(await executeRun({
        baseGraph,
        combination,
        goal,
        graphHash,
        graphRevision,
        index,
        seed: seed + index,
        services,
        trialId,
      }));
    }
  }
  if (cancelled) {
    while (runs.length < runCount) {
      runs.push(cancelledRun(runs.length, seed + runs.length));
    }
  }

  const values = runs.map((run) => run.metrics?.[goal.metric]).filter(Number.isFinite);
  const errors = runs.filter((run) => run.verdict === 'error').length;
  const passes = runs.filter((run) => run.verdict === 'pass').length;
  const fails = runs.filter((run) => run.verdict === 'fail').length;
  const verdict = cancelled || errors ? 'error' : fails ? 'fail' : 'pass';
  const summary = {
    runs: runs.length,
    passes,
    fails,
    errors,
    metric_mean: values.length ? average(values) : null,
    metric_stddev: values.length > 1 ? standardDeviation(values) : null,
    wall_ms: Math.max(0, services.clock.now() - startedAt),
    graph_hash: graphHash,
    ...(cancelled ? { code: 'CANCELLED' } : {}),
  };
  return {
    id: trialId,
    project_id: projectIdOf(graph),
    goal: clone(goal),
    parameters: clone([...parameters].sort((left, right) =>
      compareText(left.node, right.node) || compareText(left.property, right.property))),
    seed,
    runs,
    verdict,
    summary,
    ...(Object.keys(envOverrides ?? {}).length ? { environment_overrides: clone(envOverrides) } : {}),
  };
}

export function sweepTrial(graph, goal, parameters, envOverrides, seed, services) {
  const concurrency = services?.concurrency ?? MAX_PARALLEL_RUNS;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('Trial concurrency must be a positive integer.');
  }
  if (concurrency !== MAX_PARALLEL_RUNS) {
    throw new RangeError('Parallel trial execution is unavailable until solver and telemetry services support isolated runs.');
  }
  return runTrial(graph, goal, parameters, envOverrides, seed, {
    ...services,
    concurrency,
  });
}

export function evaluateGoal(goal, value) {
  if (!goal || typeof goal.metric !== 'string' || !goal.metric.length
      || !['min', 'max', 'target'].includes(goal.direction)) {
    throw new TypeError('Trial goal requires a metric and supported direction.');
  }
  if (!Number.isFinite(goal.tolerance) || goal.tolerance < 0
      || (goal.direction === 'target' && !Number.isFinite(goal.target))) {
    throw new TypeError('Trial goal thresholds must be finite and tolerance cannot be negative.');
  }
  if (!Number.isFinite(value)) return { verdict: 'error', code: 'INSUFFICIENT_DATA' };
  if (goal.direction === 'target') {
    return {
      verdict: Math.abs(value - goal.target) <= goal.tolerance ? 'pass' : 'fail',
    };
  }
  if (goal.direction === 'min') return { verdict: value <= goal.tolerance ? 'pass' : 'fail' };
  if (goal.direction === 'max') return { verdict: value >= goal.tolerance ? 'pass' : 'fail' };
  throw new TypeError(`Unsupported trial goal direction '${goal.direction}'.`);
}

async function executeRun({
  baseGraph, combination, goal, graphHash, graphRevision, index, seed, services, trialId,
}) {
  const runId = `${trialId}-run-${index}`;
  const graph = clone(baseGraph);
  applyParameters(graph, combination);
  let recorder;
  let finished = false;
  try {
    recorder = await services.recorder.create({
      trial_id: runId,
      project_id: projectIdOf(graph),
      graph_revision: graphRevision,
      graph_hash: graphHash,
      firmware_revision: graph.firmware?.revision ?? null,
      seed,
    });
    for (const method of ['append', 'finish', 'abort']) {
      if (typeof recorder?.[method] !== 'function') {
        throw Object.assign(new Error('Recorder returned an incomplete recording handle.'), {
          code: 'INVALID_RECORDER',
        });
      }
    }
    const solved = await services.solve(graph, { seed, signal: services.signal });
    const telemetry = solved?.telemetry ?? solved;
    if (!telemetry || typeof telemetry[Symbol.asyncIterator] !== 'function') {
      throw Object.assign(new Error('Solver must return an async iterable of telemetry samples.'), {
        code: 'INVALID_SOLVER_RESULT',
      });
    }
    for await (const sourceSample of telemetry) {
      if (isCancelled(services)) throw cancellationError();
      const sample = { ...sourceSample, trial_id: runId };
      if (sample.project_id !== projectIdOf(graph)) {
        throw Object.assign(new Error('Solver emitted telemetry for a different project.'), {
          code: 'PROJECT_MISMATCH',
        });
      }
      if (services.runtimeToken && JSON.stringify(sample).includes(services.runtimeToken)) {
        throw Object.assign(new Error('Telemetry contains a runtime token.'), { code: 'TOKEN_FORBIDDEN' });
      }
      const published = services.telemetry.publish(sample);
      await recorder.append([published], { runtimeToken: services.runtimeToken });
    }
    const metadata = await recorder.finish({
      solver_versions: solved?.solver_versions,
    });
    finished = true;
    await verifyRecording(services.recorder, runId, metadata);
    const queried = services.telemetry.query({ projectId: projectIdOf(graph), trialId: runId });
    if (queried.some((entry) => entry.dropped > 0)) {
      throw Object.assign(new Error('Telemetry overflowed before the goal metric could be computed.'), {
        code: 'TELEMETRY_DROPPED',
      });
    }
    const series = queried.map((entry) => ({
      ...entry,
      samples: entry.samples.filter((sample) => sample.quality === 'measured'),
    }));
    const metric = await services.computeMetric(goal.metric, series, goal.window);
    const value = metric?.value;
    const outcome = evaluateGoal(goal, value);
    return {
      index,
      seed,
      parameters: clone(combination),
      metrics: { [goal.metric]: Number.isFinite(value) ? value : null },
      verdict: outcome.verdict,
      telemetry_ref: runId,
      ...(outcome.code ? { error: { code: outcome.code, message: 'Metric has insufficient measured data.' } } : {}),
      ...(metadata.sample_count === 0 && outcome.verdict !== 'error'
        ? { error: { code: 'INSUFFICIENT_DATA', message: 'Recording contains no telemetry samples.' }, verdict: 'error' }
        : {}),
    };
  } catch (error) {
    let recordingFailed = false;
    if (recorder && !finished) {
      try {
        await recorder.finish();
        finished = true;
      } catch {
        recordingFailed = true;
        try {
          await recorder.abort();
        } catch {
          recordingFailed = true;
        }
      }
    }
    const safeCodes = new Set([
      'CANCELLED', 'INVALID_SOLVER_RESULT', 'INVALID_RECORDER', 'PROJECT_MISMATCH', 'TOKEN_FORBIDDEN',
      'TELEMETRY_DROPPED', 'RECORDING_TRUNCATED',
    ]);
    const code = recordingFailed || error?.code === 'RECORDING_TRUNCATED' ? 'RECORDING_FAILED'
      : safeCodes.has(error?.code) ? error.code : 'SOLVER_FAILED';
    // The reported message stays generic on purpose: it goes to an agent. With
    // WIREUP_TRIAL_DEBUG the raw cause goes to stderr for the operator instead, so a
    // swallowed error is diagnosable without being publishable.
    if (process.env.WIREUP_TRIAL_DEBUG) console.error(`trial run ${index}: ${error?.stack ?? error}`);
    return {
      index,
      seed,
      parameters: clone(combination),
      metrics: { [goal.metric]: null },
      verdict: 'error',
      telemetry_ref: recorder && finished ? runId : null,
      error: { code, message: errorMessage(code) },
    };
  }
}

function validateServices(services) {
  if (!services || typeof services !== 'object') throw new TypeError('Trial services are required.');
  for (const [name, method] of [
    ['solve', services.solve],
    ['computeMetric', services.computeMetric],
    ['recorder.create', services.recorder?.create],
    ['recorder.openRecording', services.recorder?.openRecording],
    ['telemetry.publish', services.telemetry?.publish],
    ['telemetry.query', services.telemetry?.query],
    ['clock.now', services.clock?.now],
  ]) {
    if (typeof method !== 'function') throw new TypeError(`Trial service '${name}' is required.`);
  }
  if (services.runtimeToken !== undefined
      && (typeof services.runtimeToken !== 'string' || !services.runtimeToken.length)) {
    throw new TypeError('Trial runtimeToken must be a non-empty string when provided.');
  }
}

async function verifyRecording(recorderService, trialId, metadata) {
  const recording = await recorderService.openRecording(trialId);
  if (!recording || !recording.metadata || typeof recording[Symbol.asyncIterator] !== 'function') {
    throw Object.assign(new Error('Recorder returned an invalid recording reader.'), {
      code: 'RECORDING_TRUNCATED',
    });
  }
  try {
    for await (const _sample of recording) {
      // Iteration validates each recorded sample and verifies the final count.
    }
    if (recording.truncated || recording.error
        || recording.sampleCount !== metadata.sample_count
        || recording.metadata.sample_count !== metadata.sample_count
        || recording.metadata.trial_id !== trialId) {
      throw Object.assign(new Error('Trial recording failed integrity verification.'), {
        code: 'RECORDING_TRUNCATED',
      });
    }
  } finally {
    recording.close?.();
  }
}

function validateInputs(graph, goal, parameters, envOverrides, seed) {
  if (!graph || typeof graph !== 'object' || !Array.isArray(graph.nodes)
      || !/^[a-f0-9]{32}$/.test(projectIdOf(graph) ?? '')
      || !Number.isInteger(graph.revision) || graph.revision < 0) {
    throw new TypeError('Trial requires a contract-shaped graph with project_id and revision.');
  }
  if (!goal || typeof goal.metric !== 'string' || !goal.metric.length
      || !['min', 'max', 'target'].includes(goal.direction)) {
    throw new TypeError('Trial goal requires a metric and supported direction.');
  }
  if (goal.direction === 'target' && (!Number.isFinite(goal.target) || !Number.isFinite(goal.tolerance) || goal.tolerance < 0)) {
    throw new TypeError('Target goals require a finite target and non-negative tolerance.');
  }
  if (goal.direction !== 'target' && (!Number.isFinite(goal.tolerance) || goal.tolerance < 0)) {
    throw new TypeError('Min/max goals require a finite non-negative tolerance.');
  }
  if (!Array.isArray(parameters) || !Number.isSafeInteger(seed)) throw new TypeError('Trial parameters and integer seed are required.');
  if (envOverrides !== undefined && (!envOverrides || typeof envOverrides !== 'object' || Array.isArray(envOverrides))) {
    throw new TypeError('Environment overrides must be an object.');
  }
}

function parameterCombinations(graph, parameters, maxCombinations) {
  const kinds = loadKinds().byId;
  if (parameters.some((parameter) => !parameter
      || typeof parameter.node !== 'string' || typeof parameter.property !== 'string')) {
    throw new TypeError('Sweep parameters require node and property names.');
  }
  const sorted = [...parameters].sort((left, right) =>
    compareText(left.node, right.node) || compareText(left.property, right.property));
  const seen = new Set();
  for (const parameter of sorted) {
    const key = `${parameter.node}\u0000${parameter.property}`;
    if (seen.has(key)) throw new TypeError(`Duplicate sweep parameter '${parameter.node}.${parameter.property}'.`);
    seen.add(key);
    if (!Array.isArray(parameter.values) || !parameter.values.length
        || parameter.values.some((value) => !Number.isFinite(value))) {
      throw new TypeError(`Sweep parameter '${parameter.node}.${parameter.property}' requires finite numeric values.`);
    }
    const node = graph.nodes.find((entry) => entry.id === parameter.node);
    if (!node) throw new TypeError(`Sweep parameter refers to unknown node '${parameter.node}'.`);
    const kind = kinds.get(node.kind);
    if (!kind || !Object.hasOwn(kind.properties ?? {}, parameter.property)) {
      throw new TypeError(`Sweep parameter '${parameter.node}.${parameter.property}' is not declared by kind '${node.kind}'.`);
    }
    if (typeof kind.properties[parameter.property] !== 'number') {
      throw new TypeError(`Sweep parameter '${parameter.node}.${parameter.property}' is not a numeric kind property.`);
    }
  }
  let combinations = [{}];
  for (const parameter of sorted) {
    if (combinations.length > maxCombinations / parameter.values.length) {
      throw new RangeError('Parameter sweep exceeds the capability run limit.');
    }
    combinations = combinations.flatMap((combination) => parameter.values.map((value) => ({
      ...combination,
      [parameter.node]: { ...(combination[parameter.node] ?? {}), [parameter.property]: value },
    })));
  }
  return combinations;
}

function applyParameters(graph, combination) {
  for (const [nodeId, properties] of Object.entries(combination)) {
    const node = graph.nodes.find((entry) => entry.id === nodeId);
    if (!node) throw new TypeError(`Sweep parameter refers to unknown node '${nodeId}'.`);
    node.properties = { ...(node.properties ?? {}), ...properties };
  }
}

/**
 * The project id a run is scoped to.
 *
 * A v3 graph carries it as id; older callers pass it as project_id. Both are accepted because
 * contracts/graph.schema.json rejects an unknown graph property, so the id has exactly one legal home.
 */
function projectIdOf(graph) {
  return graph?.project_id ?? graph?.id;
}

function isCancelled(services) {
  return services.signal?.aborted
    || (Number.isFinite(services.deadlineMs) && services.clock.now() >= services.deadlineMs);
}

function cancelledRun(index, seed) {
  return {
    index,
    seed,
    parameters: {},
    metrics: {},
    verdict: 'error',
    telemetry_ref: null,
    error: { code: 'CANCELLED', message: 'Run was not started because the trial was cancelled.' },
  };
}

function cancellationError() {
  return Object.assign(new Error('Trial cancelled between solver samples.'), { code: 'CANCELLED' });
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
  const center = average(values);
  return Math.sqrt(average(values.map((value) => (value - center) ** 2)));
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorMessage(code) {
  const messages = {
    CANCELLED: 'Trial was cancelled.',
    INVALID_SOLVER_RESULT: 'Solver returned an invalid telemetry stream.',
    INVALID_RECORDER: 'Recorder returned an incomplete recording handle.',
    PROJECT_MISMATCH: 'Solver emitted telemetry for a different project.',
    TOKEN_FORBIDDEN: 'Telemetry contained a forbidden runtime token.',
    TELEMETRY_DROPPED: 'Telemetry overflowed before the goal metric could be computed.',
    RECORDING_TRUNCATED: 'The telemetry recording is incomplete.',
    RECORDING_FAILED: 'The telemetry recording could not be finalized.',
    SOLVER_FAILED: 'Solver or trial recording failed.',
  };
  return messages[code];
}
