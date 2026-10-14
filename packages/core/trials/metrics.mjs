const MIN_SAMPLES = 3;

export const mean = (series) => aggregate(series, (values) => average(values), 1);
export const rms = (series) => aggregate(series, (values) => Math.sqrt(average(values.map((value) => value ** 2))), 1);
export const stddev = (series) => aggregate(series, (values) => {
  const center = average(values);
  return Math.sqrt(average(values.map((value) => (value - center) ** 2)));
}, 3);
export const min = (series) => aggregate(series, (values) => reduceExtrema(values).min, 1);
export const max = (series) => aggregate(series, (values) => reduceExtrema(values).max, 1);
export const peakToPeak = (series) => aggregate(series, (values) => {
  const extrema = reduceExtrema(values);
  return extrema.max - extrema.min;
}, 2);
export const meanAbsolute = (series) => aggregate(series, (values) => average(values.map(Math.abs)), 1);

export function riseTime(series, low = 0.1, high = 0.9) {
  return crossingDuration(series, low, high, true);
}

export function fallTime(series, high = 0.9, low = 0.1) {
  return crossingDuration(series, high, low, false);
}

export function settleTime(series, target, tolerance) {
  const points = numericPoints(series);
  if (points.length < MIN_SAMPLES || !Number.isFinite(target) || !Number.isFinite(tolerance) || tolerance < 0) {
    return insufficient(points.length);
  }
  let lastOutside = -1;
  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (Math.abs(points[index].value - target) > tolerance) {
      lastOutside = index;
      break;
    }
  }
  return metric(lastOutside < 0 ? 0 : points[lastOutside + 1]?.t ?? null, points.length);
}

export function steadyState(series, k) {
  const points = numericPoints(series);
  if (!Number.isInteger(k) || k < 1 || points.length < k || k < 2) return insufficient(points.length);
  return metric(average(points.slice(-k).map((point) => point.value)), k);
}

export function integral(series) {
  const points = numericPoints(series);
  if (points.length < 2) return insufficient(points.length);
  let area = 0;
  for (let index = 1; index < points.length; index += 1) {
    const dt = points[index].t - points[index - 1].t;
    if (dt < 0) return insufficient(points.length);
    area += (points[index - 1].value + points[index].value) * dt / 2;
  }
  return metric(area, points.length);
}

export function rate(series) {
  return linearFitSlope(series);
}

export function overshoot(series, target) {
  const points = numericPoints(series);
  if (points.length < 2 || !Number.isFinite(target)) return insufficient(points.length);
  const peak = reduceExtrema(points.map((point) => point.value)).max;
  return metric(Math.max(0, peak - target), points.length);
}

export function timeToFirstCrossing(series, target) {
  const points = numericPoints(series);
  if (points.length < 2 || !Number.isFinite(target)) return insufficient(points.length);
  const crossing = points.find((point) => point.value >= target);
  return metric(crossing ? crossing.t : null, points.length);
}

export function dutyCycle(series, threshold = 0.5) {
  const points = numericPoints(series);
  if (points.length < 2 || !Number.isFinite(threshold)) return insufficient(points.length);
  let high = 0;
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const duration = points[index].t - points[index - 1].t;
    if (duration < 0) return insufficient(points.length);
    if (points[index - 1].value >= threshold) high += duration;
    total += duration;
  }
  return metric(total ? high / total : null, points.length);
}

export function correlation(leftSeries, rightSeries) {
  const left = numericPoints(leftSeries);
  const right = numericPoints(rightSeries);
  const length = Math.min(left.length, right.length);
  if (length < MIN_SAMPLES) return insufficient(length);
  const xs = left.slice(0, length).map((point) => point.value);
  const ys = right.slice(0, length).map((point) => point.value);
  const mx = average(xs);
  const my = average(ys);
  const covariance = average(xs.map((value, index) => (value - mx) * (ys[index] - my)));
  const denominator = Math.sqrt(average(xs.map((value) => (value - mx) ** 2))
    * average(ys.map((value) => (value - my) ** 2)));
  return metric(denominator === 0 ? null : covariance / denominator, length);
}

export function linearFitSlope(series) {
  const points = numericPoints(series);
  if (points.length < 2) return insufficient(points.length);
  const xMean = average(points.map((point) => point.t));
  const yMean = average(points.map((point) => point.value));
  const denominator = points.reduce((sum, point) => sum + (point.t - xMean) ** 2, 0);
  if (denominator === 0) return insufficient(points.length);
  return metric(points.reduce((sum, point) => sum + (point.t - xMean) * (point.value - yMean), 0) / denominator, points.length);
}

export function linearFitIntercept(series) {
  const points = numericPoints(series);
  const slope = linearFitSlope(series);
  if (slope.insufficient || slope.value === null || points.length < 2) return insufficient(points.length);
  return metric(average(points.map((point) => point.value))
    - slope.value * average(points.map((point) => point.t)), points.length);
}

function crossingDuration(series, fromFraction, toFraction, rising) {
  const points = numericPoints(series);
  if (points.length < 2
      || !Number.isFinite(fromFraction) || !Number.isFinite(toFraction)
      || fromFraction < 0 || fromFraction > 1 || toFraction < 0 || toFraction > 1
      || points.some((point, index) => index > 0 && point.t < points[index - 1].t)) {
    return insufficient(points.length);
  }
  const extrema = reduceExtrema(points.map((point) => point.value));
  if (extrema.max === extrema.min) return insufficient(points.length);
  const startThreshold = extrema.min + (extrema.max - extrema.min) * fromFraction;
  const endThreshold = extrema.min + (extrema.max - extrema.min) * toFraction;
  const startIndex = points.findIndex((point) =>
    rising ? point.value >= startThreshold : point.value <= startThreshold);
  const endIndex = startIndex < 0 ? -1 : points.findIndex((point, index) =>
    index >= startIndex && (rising ? point.value >= endThreshold : point.value <= endThreshold));
  const start = startIndex < 0 ? undefined : points[startIndex];
  const end = endIndex < 0 ? undefined : points[endIndex];
  return metric(start && end && end.t >= start.t ? end.t - start.t : null, points.length);
}

function aggregate(series, calculate, minimum) {
  const values = numericPoints(series).map((point) => point.value);
  if (values.length < minimum) return insufficient(values.length);
  return metric(calculate(values), values.length);
}

function numericPoints(series) {
  const samples = Array.isArray(series) ? series : series?.samples;
  if (!Array.isArray(samples)) return [];
  return samples.filter((sample) => Number.isFinite(sample?.t)
      && typeof sample.value === 'number' && Number.isFinite(sample.value))
    .map((sample) => ({ t: sample.t, value: sample.value }));
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function reduceExtrema(values) {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min, max };
}

function metric(value, samples) {
  return {
    value: typeof value === 'number' && Number.isFinite(value) ? value : null,
    samples,
    insufficient: !(typeof value === 'number' && Number.isFinite(value)),
  };
}

function insufficient(samples) {
  return { value: null, samples, insufficient: true };
}
