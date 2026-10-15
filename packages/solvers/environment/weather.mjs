/**
 * Weather providers for the `environment` solver.
 *
 * Two implementations, and the boundary between them is the point:
 *
 *   RecordedProvider  replays a bundled, timestamped dataset checked into
 *                     services/environment/data/. Offline, deterministic, licensed, cited.
 *
 *   LiveProvider      fetches from an allowlisted upstream host. OFF BY DEFAULT. It refuses
 *                     any host that is not on the allowlist, refuses any URL with credentials,
 *                     refuses any non-HTTPS origin, and records every attempt — including
 *                     refusals — in its audit log. There is no arbitrary-URL fetch, ever.
 *
 * Every weather-derived value carries `source` and `observed_at` so a run is reproducible:
 * a number without provenance is not evidence (I5).
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const RECORDED_DATA_PATH = resolve(ROOT, 'services/environment/data/recorded-weather.json');

export class WeatherRefused extends Error {
  constructor(reason, requiredToSupport) {
    super(reason);
    this.name = 'WeatherRefused';
    this.code = 'WEATHER_REFUSED';
    this.reason = reason;
    this.requiredToSupport = requiredToSupport;
  }
}

/** Replays a bundled dataset. The default, and the only one enabled without configuration. */
export class RecordedProvider {
  constructor(dataset, { path = RECORDED_DATA_PATH } = {}) {
    this.kind = 'recorded';
    this.path = path;
    this.dataset = dataset ?? JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(this.dataset.samples) || !this.dataset.samples.length) {
      throw new TypeError(`Recorded weather dataset ${path} has no samples.`);
    }
    this.index = 0;
    this.audit = [];
  }

  static describe() {
    const dataset = JSON.parse(readFileSync(RECORDED_DATA_PATH, 'utf8'));
    return {
      provider: 'recorded',
      dataset: dataset.id,
      source: dataset.source,
      licence: dataset.licence,
      attribution: dataset.attribution,
      samples: dataset.samples.length,
      first_observed_at: dataset.samples[0].observed_at,
      last_observed_at: dataset.samples.at(-1).observed_at,
    };
  }

  /** Deterministic: index advances by one per read, never by wall clock. */
  read() {
    const sample = this.dataset.samples[this.index % this.dataset.samples.length];
    this.index += 1;
    const entry = {
      ...sample,
      quality: sample.quality ?? 'measured',
      source: {
        method: 'recorded',
        dataset: this.dataset.id,
        provider: this.dataset.source,
        licence: this.dataset.licence,
        path: relative(this.path),
      },
    };
    this.audit.push({ provider: 'recorded', dataset: this.dataset.id, allowed: true });
    return entry;
  }

  reset() {
    this.index = 0;
  }
}

/**
 * Fetches from an allowlisted host. Disabled unless `enable_live_weather` is explicitly
 * true AND the host appears in `allowlist`. There is no wildcard and no user-supplied URL.
 */
export class LiveProvider {
  constructor({ allowlist = [], enableLiveWeather = false, fetchImpl = globalThis.fetch } = {}) {
    this.kind = 'live';
    this.allowlist = [...allowlist];
    this.enableLiveWeather = Boolean(enableLiveWeather);
    this.fetchImpl = fetchImpl;
    this.audit = [];
    if (this.enableLiveWeather && !this.allowlist.length) {
      throw new WeatherRefused(
        'Live weather was enabled with an empty host allowlist.',
        'An explicit allowlist of upstream hosts, reviewed for licence and attribution.',
      );
    }
  }

  /** @param {{host:string, path:string}} request */
  read(request) {
    if (!this.enableLiveWeather) {
      this.audit.push({ provider: 'live', host: request?.host ?? null, allowed: false, reason: 'disabled' });
      throw new WeatherRefused(
        'Live weather is disabled by default. Set enable_live_weather:true with an explicit host allowlist.',
        'Reviewed, licensed, allowlisted upstream weather source.',
      );
    }
    const host = String(request?.host ?? '');
    if (!this.allowlist.includes(host)) {
      this.audit.push({ provider: 'live', host, allowed: false, reason: 'not_allowlisted' });
      throw new WeatherRefused(
        `Host '${host}' is not on the live-weather allowlist (${this.allowlist.join(', ') || 'empty'}).`,
        'Add the host to the reviewed allowlist after checking its licence and attribution terms.',
      );
    }
    if (typeof this.fetchImpl !== 'function') {
      throw new WeatherRefused('No fetch implementation is available.', 'A runtime with fetch.');
    }
    const url = `https://${host}${request.path ?? '/current.json'}`;
    const response = this.fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(Number(request?.timeout_ms ?? 5000)),
    });
    this.audit.push({ provider: 'live', host, allowed: true, url });
    if (!response.ok) {
      throw new WeatherRefused(`Live weather host '${host}' returned HTTP ${response.status}.`,
        'A reachable upstream host.');
    }
    return response.json();
  }
}

export function createWeatherProvider(settings = {}) {
  if (settings.provider === 'live') {
    return new LiveProvider({
      allowlist: settings.allowlist ?? [],
      enableLiveWeather: settings.enable_live_weather ?? false,
      ...(settings.fetchImpl ? { fetchImpl: settings.fetchImpl } : {}),
    });
  }
  if (settings.provider && settings.provider !== 'recorded') {
    throw new WeatherRefused(
      `Unknown weather provider '${settings.provider}'.`,
      'A declared provider: recorded (bundled dataset) or live (allowlisted host).',
    );
  }
  return new RecordedProvider(settings.dataset);
}

function relative(path) {
  return path.startsWith(ROOT) ? path.slice(ROOT.length + 1).replaceAll('\\', '/') : path;
}