import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { createGunzip, createGzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { canonicalStringify } from '../graph/canonical.mjs';
import { loadContracts, validateTelemetry } from '../graph/contracts.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../backend/data');

export class TelemetryRecorder {
  constructor({ root = ROOT, clock = Date, channelCatalogue } = {}) {
    this.root = resolve(root);
    this.clock = clock;
    this.channelCatalogue = channelCatalogue ?? loadChannelCatalogue();
    this.channelCatalogueHash = createHash('sha256')
      .update(canonicalStringify(this.channelCatalogue))
      .digest('hex');
  }

  async create(meta) {
    validateMetadata(meta);
    const directory = resolve(this.root, 'trials', meta.trial_id);
    if (!directory.startsWith(`${resolve(this.root, 'trials')}${sep}`)) {
      throw new TypeError('Invalid trial id.');
    }
    await mkdir(directory, { recursive: true });
    const path = resolve(directory, 'telemetry.ndjson.gz');
    const gzip = createGzip({ level: 9, mtime: 0 });
    const output = createWriteStream(path, { flags: 'wx' });
    const finished = pipeline(gzip, output);
    const startedAt = this.clock.now();
    const clock = this.clock;
    const channelCatalogueHash = this.channelCatalogueHash;
    const state = {
      count: 0,
      dropped: 0,
      closed: false,
      async append(samples, { dropped = 0, runtimeToken } = {}) {
        if (state.closed) throw new Error('Cannot append to a closed telemetry recording.');
        if (!Array.isArray(samples)) throw new TypeError('Telemetry batch must be an array.');
        for (const sample of samples) {
          validateSample(sample, runtimeToken);
          const line = `${canonicalStringify(sample)}\n`;
          if (!gzip.write(line)) await once(gzip, 'drain');
          state.count += 1;
        }
        if (!Number.isInteger(dropped) || dropped < 0) throw new TypeError('Dropped sample count must be a non-negative integer.');
        state.dropped += dropped;
      },
      async finish(options = {}) {
        if (state.closed) throw new Error('Telemetry recording has already been closed.');
        state.closed = true;
        gzip.end();
        await finished;
        const endedAt = options.endedAt ?? clock.now();
        const completeMeta = {
          trial_id: meta.trial_id,
          project_id: meta.project_id,
          graph_revision: meta.graph_revision,
          ...(meta.graph_hash ? { graph_hash: meta.graph_hash } : {}),
          firmware_revision: meta.firmware_revision ?? null,
          seed: meta.seed,
          solver_versions: options.solver_versions ?? meta.solver_versions ?? {},
          started_at: new Date(startedAt).toISOString(),
          ended_at: new Date(endedAt).toISOString(),
          sample_count: state.count,
          dropped_count: state.dropped,
          channel_catalogue_hash: channelCatalogueHash,
        };
        await writeFile(resolve(directory, 'meta.json'), `${canonicalStringify(completeMeta)}\n`, { flag: 'wx' });
        return completeMeta;
      },
      async abort() {
        if (state.closed) return;
        state.closed = true;
        gzip.destroy(new Error('Telemetry recording aborted.'));
        await finished.catch(() => undefined);
      },
    };
    return state;
  }

  async openRecording(trialId) {
    validateTrialId(trialId);
    const directory = resolve(this.root, 'trials', trialId);
    const [metaText] = await Promise.all([
      readFile(resolve(directory, 'meta.json'), 'utf8'),
    ]);
    const metadata = JSON.parse(metaText);
    const source = createReadStream(resolve(directory, 'telemetry.ndjson.gz'));
    const gunzip = createGunzip();
    source.pipe(gunzip);
    const lines = createInterface({ input: gunzip, crlfDelay: Infinity });
    return new RecordingReader({ metadata, source, gunzip, lines });
  }
}

export class RecordingReader {
  constructor({ metadata, source, gunzip, lines }) {
    this.metadata = metadata;
    this.source = source;
    this.gunzip = gunzip;
    this.lines = lines;
    this.truncated = false;
    this.sampleCount = 0;
    this.error = null;
  }

  async *[Symbol.asyncIterator]() {
    try {
      for await (const line of this.lines) {
        if (!line) continue;
        const sample = JSON.parse(line);
        validateSample(sample);
        this.sampleCount += 1;
        yield sample;
      }
      if (this.sampleCount !== this.metadata.sample_count) {
        this.truncated = true;
        throw new Error(`Recording sample count mismatch: expected ${this.metadata.sample_count}, read ${this.sampleCount}.`);
      }
    } catch (error) {
      this.truncated = true;
      this.error = error;
      throw Object.assign(new Error(`Telemetry recording is truncated or corrupt: ${error.message}`), {
        code: 'RECORDING_TRUNCATED',
        truncated: true,
      });
    }
  }

  close() {
    this.lines.close();
    this.source.destroy();
    this.gunzip.destroy();
  }
}

function loadChannelCatalogue() {
  const path = resolve(dirname(fileURLToPath(import.meta.url)), '../../../contracts/telemetry.channels.json');
  return JSON.parse(readFileSync(path, 'utf8'));
}

function validateMetadata(meta) {
  if (!meta || typeof meta !== 'object') throw new TypeError('Recording metadata is required.');
  validateTrialId(meta.trial_id);
  if (!/^[a-f0-9]{32}$/.test(meta.project_id ?? '')) throw new TypeError('Recording project id must be 32 lowercase hex characters.');
  if (!Number.isInteger(meta.graph_revision) || meta.graph_revision < 0) throw new TypeError('Recording graph revision must be a non-negative integer.');
  if (meta.graph_hash !== undefined
      && (typeof meta.graph_hash !== 'string' || !/^(?:[a-f0-9]{64}|fnv1a-[a-f0-9]{16})$/.test(meta.graph_hash))) {
    throw new TypeError('Recording graph_hash must be a canonical content hash.');
  }
  if (!Number.isInteger(meta.seed)) throw new TypeError('Recording seed must be an integer.');
}

function validateTrialId(trialId) {
  if (typeof trialId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(trialId)) {
    throw new TypeError('Trial id must be 1 to 128 letters, digits, underscores, or hyphens.');
  }
}

function validateSample(sample, runtimeToken) {
  const issues = validateTelemetry(sample);
  if (issues.length) {
    throw new TypeError(`Invalid telemetry sample: ${issues.map((issue) => `${issue.pointer || '/'} ${issue.message}`).join('; ')}`);
  }
  if (sample.quality === 'unavailable' && sample.value !== null) {
    throw new TypeError('Unavailable telemetry must carry value:null.');
  }
  if (runtimeToken && JSON.stringify(sample).includes(runtimeToken)) {
    throw new TypeError('Runtime token is forbidden in telemetry.');
  }
  if (Object.keys(sample).some((key) => /token|secret|credential|api.?key/i.test(key))) {
    throw new TypeError('Credential-bearing fields are forbidden in telemetry.');
  }
}
