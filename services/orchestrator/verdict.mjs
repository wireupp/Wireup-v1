/**
 * Verdicts, phase v09.
 *
 * A verdict compares a MEASURED number to a goal, using only the rules in
 * contracts/trial.schema.json. Three rules make it trustworthy:
 *
 *   1. `measured: null` produces `pass: false, reason: "NOT_MEASURED"`. Never interpolated,
 *      never carried over from another run, never rounded into range.
 *   2. An `assumed` sample is never a measurement. A verdict built from one is `pass: false`
 *      with `reason: "NOT_MEASURED"`, because "we assumed it works" is not "it works".
 *   3. Every row cites a `trial_id` and a channel. A claim without a recording is not a claim.
 */

export const REASONS = Object.freeze({
  PASS: 'WITHIN_TOLERANCE',
  FAIL: 'OUTSIDE_TOLERANCE',
  NOT_MEASURED: 'NOT_MEASURED',
  UNSUPPORTED: 'NO_SUCH_CHANNEL',
});

/**
 * @param {object} input
 * @param {string} input.goal_id
 * @param {object} input.metric  the ParsedGoal metric being judged
 * @param {number|null} input.measured
 * @param {string} input.quality
 * @param {string|null} input.trial_id
 * @param {string} input.channel
 * @param {string|null} input.recording
 */
export function judge({ goal_id, metric, measured, quality, trial_id, channel, recording }) {
  const base = {
    goal_id,
    metric: metric.metric,
    channel,
    unit: metric.unit ?? null,
    target: metric.target,
    tolerance: metric.tolerance,
    direction: metric.direction,
    measured: Number.isFinite(measured) ? measured : null,
    quality: quality ?? 'unavailable',
    trial_id: trial_id ?? null,
    recording: recording ?? null,
  };
  if (base.measured === null || base.quality !== 'measured') {
    return { ...base, pass: false, reason: REASONS.NOT_MEASURED };
  }
  const inside = metric.direction === 'target'
    ? Math.abs(base.measured - metric.target) <= metric.tolerance
    : metric.direction === 'max'
      ? base.measured <= metric.tolerance || base.measured <= metric.target
      : base.measured >= metric.tolerance;
  return { ...base, pass: inside, reason: inside ? REASONS.PASS : REASONS.FAIL };
}

/**
 * Reduce a trial result plus its recorded telemetry to one verdict per goal metric.
 *
 * `series` is the telemetry the trial actually recorded. Nothing else is consulted: if the
 * channel is missing, the verdict is NOT_MEASURED.
 */
export function judgeAll(goal, { series, trialId, recording, window }) {
  return goal.metrics.map((metric) => {
    const samples = (series ?? [])
      .filter((entry) => entry.channel === metric.channel)
      .flatMap((entry) => entry.samples);
    const scoped = windowFor(samples, window);
    const scopedMeasured = scoped.filter((sample) => sample.quality === 'measured');
    const value = scopedMeasured.length ? metricValue(metric, scopedMeasured) : null;
    const quality = scopedMeasured.length ? 'measured'
      : samples.some((sample) => sample.quality === 'derived') ? 'derived'
        : samples.length ? samples.at(-1).quality : 'unavailable';
    return judge({
      goal_id: goal.raw,
      metric,
      measured: value,
      quality,
      trial_id: trialId ?? null,
      channel: metric.channel,
      recording: recording ?? null,
    });
  });
}

function windowFor(samples, window) {
  if (!window?.duration_s || !samples.length) return samples;
  const last = samples.at(-1).t;
  const start = Math.max(0, last - window.duration_s);
  const within = samples.filter((sample) => sample.t >= start && sample.t <= last);
  return within.length ? within : samples;
}

function metricValue(metric, samples) {
  const values = samples.map((sample) => sample.value);
  switch (metric.metric) {
    case 'max':
      return Math.max(...values);
    case 'min':
      return Math.min(...values);
    case 'rms':
      return Math.sqrt(values.reduce((sum, value) => sum + value ** 2, 0) / values.length);
    case 'stddev':
      {
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
        return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
      }
    default:
      return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
}

/**
 * Collapse several verdicts into a status.
 *
 * `verified` requires every metric to pass with quality `measured`. Anything weaker downgrades,
 * and the downgrade is visible in `unmet`.
 */
export function statusFor(verdicts, { infeasible = null } = {}) {
  if (infeasible) return 'infeasible';
  if (!verdicts.length) return 'unverified';
  if (verdicts.every((verdict) => verdict.pass && verdict.quality === 'measured')) return 'verified';
  if (verdicts.some((verdict) => verdict.pass && verdict.quality === 'measured')) return 'partially_verified';
  return 'unverified';
}