import { loadContracts, validateTelemetry } from '../graph/contracts.mjs';

const DEFAULT_CAPACITY = 8192;

export class TelemetryBus {
  constructor({ clock = Date, capacity = loadCapacity(), subscriberQueue = 1 } = {}) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('Telemetry capacity must be a positive integer.');
    if (!Number.isInteger(subscriberQueue) || subscriberQueue < 1) throw new RangeError('Subscriber queue must be a positive integer.');
    this.clock = clock;
    this.capacity = capacity;
    this.subscriberQueue = subscriberQueue;
    this.seq = 0;
    this.buffers = new Map();
    this.subscribers = new Set();
  }

  publish(input) {
    const sample = structuredClone(input);
    delete sample.seq;
    const issues = validateTelemetry(sample);
    if (issues.length) {
      throw new TypeError(`Invalid telemetry sample: ${issues.map((issue) => `${issue.pointer || '/'} ${issue.message}`).join('; ')}`);
    }
    validateShape(sample);
    sample.seq = this.seq++;
    const key = bufferKey(sample.project_id, sample.trial_id ?? null);
    let buffer = this.buffers.get(key);
    if (!buffer) {
      buffer = { slots: new Array(this.capacity), start: 0, length: 0, dropped: 0 };
      this.buffers.set(key, buffer);
    }
    const entry = { sample, publishedAt: this.clock.now() };
    if (buffer.length < this.capacity) {
      buffer.slots[(buffer.start + buffer.length) % this.capacity] = entry;
      buffer.length += 1;
    } else {
      buffer.slots[buffer.start] = entry;
      buffer.start = (buffer.start + 1) % this.capacity;
      buffer.dropped += 1;
    }
    this.#notify(sample);
    return structuredClone(sample);
  }

  subscribe(filter, handler, { onError } = {}) {
    if (typeof handler !== 'function') throw new TypeError('Telemetry subscriber must be a function.');
    const subscriber = { filter: filter ?? {}, handler, onError, pending: 0, dropped: 0, active: true };
    this.subscribers.add(subscriber);
    const unsubscribe = () => {
      subscriber.active = false;
      this.subscribers.delete(subscriber);
    };
    Object.defineProperties(unsubscribe, {
      dropped: { get: () => subscriber.dropped },
      subscriber: { value: subscriber },
    });
    return unsubscribe;
  }

  query(query) {
    validateQuery(query);
    const groups = new Map();
    let dropped = 0;
    let attempted = 0;
    for (const [key, buffer] of this.buffers) {
      const [projectId, trialId] = JSON.parse(key);
      if (projectId !== query.projectId || (query.trialId !== undefined && trialId !== query.trialId)) continue;
      dropped += buffer.dropped;
      const entries = readBuffer(buffer);
      attempted += entries.length + buffer.dropped;
      for (const { sample } of entries) {
        if (!matches(sample, query)) continue;
        const groupKey = JSON.stringify([sample.trial_id ?? null, sample.node, sample.channel, sample.unit ?? null]);
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey).push(sample);
      }
    }
    return [...groups.entries()].map(([key, samples]) => {
      const [trialId, node, channel, unit] = JSON.parse(key);
      samples.sort((a, b) => a.t - b.t || a.seq - b.seq);
      const returned = downsample(samples, query.maxSamples, query.downsample ?? 'none');
      return {
        project_id: query.projectId,
        trial_id: trialId,
        node,
        channel,
        unit,
        samples: returned,
        sample_count: samples.length,
        dropped,
        query_dropped: Math.max(0, samples.length - returned.length),
        attempted,
      };
    });
  }

  get droppedCount() {
    return [...this.buffers.values()].reduce((total, buffer) => total + buffer.dropped, 0);
  }

  #notify(sample) {
    for (const subscriber of this.subscribers) {
      if (!subscriber.active || !matchesFilter(sample, subscriber.filter)) continue;
      if (subscriber.pending >= this.subscriberQueue) {
        subscriber.dropped += 1;
        continue;
      }
      subscriber.pending += 1;
      Promise.resolve().then(() => subscriber.handler(structuredClone(sample))).then(
        () => { subscriber.pending -= 1; },
        (error) => {
          subscriber.pending -= 1;
          if (subscriber.onError) subscriber.onError(error);
          else console.error(`Telemetry subscriber failed: ${error?.message ?? 'unknown error'}`);
        },
      );
    }
  }
}

function loadCapacity() {
  const limit = loadContracts().capability?.limits?.max_telemetry_samples;
  return Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_CAPACITY;
}

function validateShape(sample) {
  const allowed = new Set([
    'project_id', 'trial_id', 't', 'node', 'channel', 'value',
    'quality', 'solver', 'unit', 'source', 'seq',
  ]);
  for (const key of Object.keys(sample)) {
    if (!allowed.has(key)) throw new TypeError(`Invalid telemetry sample: /${key} is not allowed.`);
  }
  if (!/^[a-f0-9]{32}$/.test(sample.project_id)) throw new TypeError('Telemetry project_id must be 32 lowercase hex characters.');
  if (!Number.isFinite(sample.t) || sample.t < 0) throw new TypeError('Telemetry t must be a finite non-negative number.');
  if (typeof sample.node !== 'string' || typeof sample.channel !== 'string' || !sample.channel.length) {
    throw new TypeError('Telemetry node and channel must be strings; channel cannot be empty.');
  }
  if (sample.channel.length > 128) throw new TypeError('Telemetry channel exceeds 128 characters.');
  if (typeof sample.solver !== 'string' || !sample.solver.length) throw new TypeError('Telemetry solver must be a nonempty string.');
  if (sample.trial_id !== undefined && sample.trial_id !== null && typeof sample.trial_id !== 'string') {
    throw new TypeError('Telemetry trial_id must be a string or null.');
  }
  if (sample.unit !== undefined && sample.unit !== null && typeof sample.unit !== 'string') {
    throw new TypeError('Telemetry unit must be a string or null.');
  }
  if (sample.source !== undefined && sample.source !== null
      && (!sample.source || typeof sample.source !== 'object' || Array.isArray(sample.source))) {
    throw new TypeError('Telemetry source must be an object or null.');
  }
  if (sample.quality === 'unavailable' && sample.value !== null) {
    throw new TypeError('Unavailable telemetry must carry value:null.');
  }
  if (sample.quality === 'derived') {
    const known = new Set((loadContracts().derivations.channels ?? []).map((entry) => entry.channel));
    if (!known.has(sample.channel)) {
      throw new TypeError(`Derived telemetry channel '${sample.channel}' has no contracts/derivations.json entry.`);
    }
  }
}

function bufferKey(projectId, trialId) {
  return JSON.stringify([projectId, trialId]);
}

function readBuffer(buffer) {
  return Array.from({ length: buffer.length }, (_, index) =>
    buffer.slots[(buffer.start + index) % buffer.slots.length]);
}

function matches(sample, query) {
  if (query.channels && !query.channels.includes(sample.channel)) return false;
  if (query.nodes && !query.nodes.includes(sample.node)) return false;
  if (query.tFrom !== undefined && sample.t < query.tFrom) return false;
  if (query.tTo !== undefined && sample.t > query.tTo) return false;
  if (query.sinceSeq !== undefined && sample.seq < query.sinceSeq) return false;
  return true;
}

function matchesFilter(sample, filter) {
  return (filter.projectId === undefined || filter.projectId === sample.project_id)
    && (filter.trialId === undefined || filter.trialId === sample.trial_id)
    && (filter.node === undefined || filter.node === sample.node)
    && (filter.channel === undefined || filter.channel === sample.channel)
    && (filter.sinceSeq === undefined || sample.seq >= filter.sinceSeq);
}

function validateQuery(query) {
  if (!query || typeof query.projectId !== 'string' || !/^[a-f0-9]{32}$/.test(query.projectId)) {
    throw new TypeError('Telemetry query requires a 32-character lowercase hexadecimal projectId.');
  }
  if (query.trialId !== undefined && query.trialId !== null && typeof query.trialId !== 'string') {
    throw new TypeError('Telemetry query trialId must be a string or null.');
  }
  for (const key of ['channels', 'nodes']) {
    if (query[key] !== undefined
        && (!Array.isArray(query[key]) || query[key].some((value) => typeof value !== 'string'))) {
      throw new TypeError(`Telemetry query ${key} must be an array of strings.`);
    }
  }
  for (const key of ['tFrom', 'tTo']) {
    if (query[key] !== undefined && (!Number.isFinite(query[key]) || query[key] < 0)) {
      throw new TypeError(`Telemetry query ${key} must be a non-negative finite number.`);
    }
  }
  if (query.tFrom !== undefined && query.tTo !== undefined && query.tFrom > query.tTo) {
    throw new RangeError('Telemetry query tFrom cannot exceed tTo.');
  }
  if (query.maxSamples !== undefined
      && (!Number.isInteger(query.maxSamples) || query.maxSamples < 1)) {
    throw new RangeError('Telemetry query maxSamples must be a positive integer.');
  }
  if (query.sinceSeq !== undefined && (!Number.isInteger(query.sinceSeq) || query.sinceSeq < 0)) {
    throw new RangeError('Telemetry query sinceSeq must be a non-negative integer.');
  }
  if (query.downsample !== undefined && !['none', 'minmax', 'mean'].includes(query.downsample)) {
    throw new TypeError(`Unknown telemetry downsample mode '${query.downsample}'.`);
  }
}

function downsample(samples, maxSamples, mode) {
  if (!['none', 'minmax', 'mean'].includes(mode)) throw new TypeError(`Unknown telemetry downsample mode '${mode}'.`);
  if (maxSamples === undefined || samples.length <= maxSamples) return samples;
  if (mode === 'none') return samples.slice(-maxSamples);
  if (!samples.every((sample) => typeof sample.value === 'number' && Number.isFinite(sample.value))) {
    return samples.slice(-maxSamples);
  }
  const result = [];
  if (maxSamples === 1) return [samples.at(-1)];
  const bucketCount = Math.max(1, Math.floor(maxSamples / 2));
  const bucketSize = samples.length / bucketCount;
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = Math.floor(bucket * bucketSize);
    const end = Math.floor((bucket + 1) * bucketSize);
    const current = samples.slice(start, Math.max(start + 1, end));
    if (mode === 'mean') {
      result.push({
        ...current[Math.floor(current.length / 2)],
        value: current.reduce((sum, sample) => sum + sample.value, 0) / current.length,
        quality: 'derived',
        source: { method: 'telemetry.mean_downsample', sample_count: current.length },
      });
    } else {
      const low = current.reduce((best, sample) => sample.value < best.value ? sample : best);
      const high = current.reduce((best, sample) => sample.value > best.value ? sample : best);
      result.push(...(low.seq === high.seq
        ? [low]
        : [low, high].sort((a, b) => a.seq - b.seq)));
    }
  }
  return result;
}
