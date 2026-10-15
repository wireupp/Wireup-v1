import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { cleanup, runCase } from '../../_harness.mjs';
import { environmentSolver } from '../../../../packages/solvers/environment/solver.mjs';
import {
  LiveProvider, RecordedProvider, WeatherRefused, createWeatherProvider,
} from '../../../../packages/solvers/environment/weather.mjs';
import { runProbes } from '../../../../packages/core/trials/probes.mjs';

/**
 * Acceptance A1 (determinism), A9 (live weather off, allowlist enforced) and the provenance
 * requirement: every weather-derived sample carries its source and timestamp.
 *
 * The provenance assertion is the one that matters most. A weather number with no stated source
 * is not evidence, and a replay that cannot be reproduced is not a measurement.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const graph = JSON.parse(readFileSync(resolve(HERE, 'project.json'), 'utf8'));
const selected = process.argv[2];
if (selected !== undefined && !/^A\d$/.test(selected)) throw new TypeError(`Unknown selector '${selected}'.`);

let passed = 0;
function check(id, name, fn) {
  if (selected && selected !== id) return;
  fn();
  passed += 1;
  process.stdout.write(`PASS ${id} ${name}\n`);
}

const { result, series, root } = await runCase(graph, {
  metric: 'mean', direction: 'target', target: 0, tolerance: 1e9,
}, { solver: environmentSolver });

try {
  const wind = series.flatMap((entry) => entry.samples).filter((s) => s.channel === 'env.wind_speed_mps');

  check('A1', 'the recorded dataset replays and completes without error', () => {
    assert.equal(result.verdict, 'pass', `verdict was ${result.verdict}`);
    assert.equal(wind.length, 24, `expected 24 hourly samples, got ${wind.length}`);
  });

  check('A2', 'the replay order is the dataset order, not wall clock order', () => {
    const dataset = JSON.parse(readFileSync(
      resolve(HERE, '../../../../services/environment/data/recorded-weather.json'), 'utf8'));
    wind.forEach((sample, index) => {
      assert.equal(sample.value, dataset.samples[index].wind_speed_mps,
        `sample ${index} did not match the recorded series`);
    });
  });

  check('A3', 'every weather sample carries its source and timestamp', () => {
    const samples = series.flatMap((entry) => entry.samples);
    assert.ok(samples.length > 100, `only ${samples.length} samples were published`);
    const missing = samples.filter((sample) => !sample.source || typeof sample.source !== 'object');
    assert.equal(missing.length, 0, `${missing.length} samples carry no source object`);
    for (const sample of samples) {
      if (sample.channel === 'env.air_density_kg_m3') {
        assert.equal(sample.source.model, 'ISA troposphere');
        continue;
      }
      assert.equal(sample.source.dataset, 'wireup-reference-coastal-24h');
      assert.equal(sample.source.provider, 'WireUp synthetic generator (seeded sum-of-harmonics), no third-party data');
      assert.equal(sample.source.licence, 'CC0-1.0');
      assert.match(String(sample.source.observed_at), /^\d{4}-\d{2}-\d{2}T/);
    }
  });

  check('A4', 'a second replay of the same dataset is byte-identical', () => {
    const first = new RecordedProvider();
    const second = new RecordedProvider();
    for (let index = 0; index < 24; index += 1) {
      assert.deepEqual(first.read(), second.read());
    }
    // Wrapping around must restart cleanly rather than throw or drift.
    assert.equal(first.index, 24);
    assert.equal(second.index, 24);
    assert.deepEqual(first.read(), second.read());
    assert.equal(first.index, 25);
    assert.deepEqual(first.read(), second.read());
    assert.equal(first.index, 26);
    assert.equal(second.index, 26);
  });

  check('A5', 'live weather is off by default and refuses without an allowlist', () => {
    const live = createWeatherProvider({ provider: 'live' });
    assert.throws(() => live.read({ host: 'api.example.com' }), (error) => {
      assert.ok(error instanceof WeatherRefused);
      assert.match(error.message, /disabled by default/i);
      assert.ok(error.requiredToSupport.length > 10, 'the refusal must say what would enable it');
      return true;
    });
    assert.equal(live.audit.at(-1).allowed, false, 'the refusal was not recorded');
    assert.throws(() => createWeatherProvider({ provider: 'live', enable_live_weather: true }),
      /empty host allowlist/);
  });

  check('A6', 'a non-allowlisted host is refused and the attempt is recorded', () => {
    let fetched = false;
    const live = new LiveProvider({
      allowlist: ['weather.example.org'],
      enableLiveWeather: true,
      fetchImpl: async () => {
        fetched = true;
        return { ok: true, json: async () => ({}) };
      },
    });
    assert.throws(() => live.read({ host: '10.0.0.5' }), (error) => {
      assert.ok(error instanceof WeatherRefused);
      assert.match(error.message, /not on the live-weather allowlist/);
      assert.match(error.requiredToSupport, /licence and attribution/i);
      return true;
    });
    assert.equal(fetched, false, 'the provider reached the network for a non-allowlisted host');
    assert.deepEqual(live.audit.at(-1), {
      provider: 'live', host: '10.0.0.5', allowed: false, reason: 'not_allowlisted',
    });
  });

  check('A7', 'an unknown provider name is refused rather than defaulted', () => {
    assert.throws(() => createWeatherProvider({ provider: 'guess' }), (error) => {
      assert.ok(error instanceof WeatherRefused);
      assert.match(error.message, /Unknown weather provider/);
      return true;
    });
  });

  check('A8', 'the solver resolves to the recorded dataset with no settings at all', async () => {
    const plan = await environmentSolver.prepare(graph, { seed: 1 });
    assert.equal(plan.provider.kind, 'recorded');
    const described = RecordedProvider.describe();
    assert.equal(described.provider, 'recorded');
    assert.equal(described.licence, 'CC0-1.0');
    assert.equal(described.samples, 24);
    await environmentSolver.dispose(plan);
  });
} finally {
  await cleanup(root);
}

if (selected && passed !== 1) throw new Error(`Acceptance ${selected} did not run exactly once.`);
process.stdout.write(`environment/recorded-weather: ${passed} assertion(s) passed\n`);