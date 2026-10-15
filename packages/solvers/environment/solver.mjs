/**
 * The `environment` solver: water, air and ground, plus weather provenance.
 *
 * It owns `env.water_body`, `env.airspace` and `env.ground`. The mechanics solver reads
 * those nodes out of the graph directly, so an environment change shows up in the physics
 * without a copy of the state living in two places.
 *
 * Live weather is OFF. `enable_live_weather` is not a flag this file will act on unless the
 * caller also supplies a non-empty host allowlist, and every refusal is recorded in the
 * provider audit log. There is no code path that fetches an arbitrary URL.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SolverUnavailable, validateManifest } from '../protocol.mjs';
import { RECORDED_DATA_PATH, WeatherRefused, createWeatherProvider } from './weather.mjs';
import { standardAtmosphere } from '../mechanics/aero.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const KINDS = JSON.parse(readFileSync(resolve(ROOT, 'contracts/kinds.json'), 'utf8')).kinds;

const KIND_IDS = ['env.airspace', 'env.ground', 'env.water_body'].sort();

const TELEMETRY_CHANNELS = [
  'env.air_density_kg_m3',
  'env.air_temperature_c',
  'env.gust_speed_mps',
  'env.pressure_hpa',
  'env.sea_temperature_c',
  'env.visibility_m',
  'env.water_density_kg_m3',
  'env.wave_height_m',
  'env.wind_direction_deg',
  'env.wind_speed_mps',
].sort();

const UNAVAILABLE = [
  {
    feature: 'live weather by default',
    kind: 'env.airspace',
    reason: 'Live weather is disabled. The recorded dataset is the only source used unless a reviewed allowlist is configured.',
    requiredToSupport: 'A licensed, attributed upstream host added to an explicit allowlist, with its terms recorded.',
  },
  {
    feature: 'fetched weather at all, without configuration',
    kind: 'env.airspace',
    reason: 'This solver refuses every weather request that is not the bundled recorded dataset or an explicitly allowlisted live host.',
    requiredToSupport: 'An explicit enable_live_weather setting together with a host allowlist.',
  },
  {
    feature: 'ocean current fields',
    kind: 'env.water_body',
    reason: 'Water bodies declare a single uniform flow vector. No tidal, geostrophic or eddy fields.',
    requiredToSupport: 'A current field model (tidal harmonic or regional ocean model) with cited data.',
  },
  {
    feature: 'breaking waves and run-up',
    kind: 'env.water_body',
    reason: 'The surface is a sum of declared sinusoids or flat. No shoaling, breaking, run-up or overtopping.',
    requiredToSupport: 'A free-surface solver validated against a wave basin.',
  },
  {
    feature: 'terrain elevation data',
    kind: 'env.ground',
    reason: 'Ground is a declared height, friction and restitution. No DEM, no terrain profile.',
    requiredToSupport: 'A sourced elevation model with a stated resolution and licence.',
  },
];

export const manifest = validateManifest({
  id: 'environment',
  version: '1',
  kindIds: KIND_IDS,
  telemetryChannels: TELEMETRY_CHANNELS,
  analyses: ['time', 'steady_state'],
  limits: { maxNodes: 64, maxSimSeconds: 3600 },
  verification: {
    tests: ['environment/recorded-weather', 'mechanics/drone-hover', 'mechanics/boat-speed'],
  },
  knownFailures: [
    {
      code: 'STD_ATMOSPHERE_ABOVE_TROPOSPHERE',
      condition: 'altitude above 11 km',
      message: 'The ISA troposphere is refused rather than extrapolated.',
    },
  ],
  unavailable: UNAVAILABLE,
});

async function selfTest() {
  const declared = new Set(KINDS.map((kind) => kind.id));
  for (const kindId of KIND_IDS) {
    if (!declared.has(kindId)) return false;
    const kind = KINDS.find((entry) => entry.id === kindId);
    if (!kind?.evidence?.length) return false;
    if (!kind.evidence.every((path) => existsSync(resolve(ROOT, path)))) return false;
  }
  return existsSync(RECORDED_DATA_PATH);
}

async function prepare(graph, context) {
  if (!graph || !Array.isArray(graph.nodes)) throw new TypeError('Solver graph must contain nodes.');
  const unsupported = graph.nodes.find((node) => !KIND_IDS.includes(node.kind));
  if (unsupported) {
    throw new SolverUnavailable(
      `environment simulation of '${unsupported.kind}'`,
      `The environment solver does not simulate '${unsupported.kind}'.`,
      'A tested environment implementation for this kind, with bench evidence.',
    );
  }
  const settings = { ...(context?.settings?.environment ?? {}) };
  const provider = createWeatherProvider(settings);
  return {
    solver: manifest.id,
    provider,
    nodes: graph.nodes.filter((node) => KIND_IDS.includes(node.kind)),
    // One sample per dataset entry: the recorded series is 24 hourly observations and a run
    // that does not cover all of them is not a replay.
    duration_s: context?.duration_s ?? 24,
    timestep: context?.timestep ?? 1,
  };
}

async function run(plan, context) {
  const projectId = context?.project_id;
  const steps = Math.max(1, Math.round((plan.duration_s ?? 20) / (plan.timestep ?? 1)));
  return {
    solver_versions: { environment: manifest.version },
    telemetry: (async function* stream() {
      for (let step = 0; step < steps; step += 1) {
        if (context?.signal?.aborted) throw context.signal.reason ?? new Error('Environment run aborted.');
        let reading;
        try {
          reading = plan.provider.read();
        } catch (error) {
          if (error instanceof WeatherRefused) throw Object.assign(new Error(error.message), {
            code: error.code,
            required_to_support: error.requiredToSupport,
          });
          throw error;
        }
        const airspace = plan.nodes.find((node) => node.kind === 'env.airspace');
        const atmosphere = standardAtmosphere(airspace?.properties?.altitude_m, kelvin(reading));
        for (const sample of toSamples(projectId, step * (plan.timestep ?? 1), reading, atmosphere)) {
          yield sample;
        }
      }
    })(),
  };
}

function kelvin(reading) {
  return Number.isFinite(reading?.air_temperature_c) ? reading.air_temperature_c + 273.15 : undefined;
}

function toSamples(projectId, t, reading, atmosphere) {
  const source = reading.source;
  const provenance = { ...source, dataset_sample_t: reading.t ?? null, observed_at: reading.observed_at ?? null };
  const rows = [
    ['env.wind_speed_mps', reading.wind_speed_mps, 'm/s'],
    ['env.wind_direction_deg', reading.wind_direction_deg, 'deg'],
    ['env.sea_temperature_c', reading.sea_temperature_c, 'C'],
    ['env.pressure_hpa', reading.pressure_hpa, 'hPa'],
    ['env.wave_height_m', reading.wave_height_m, 'm'],
    ['env.visibility_m', reading.visibility_m, 'm'],
  ];
  const samples = rows
    .filter(([, value]) => Number.isFinite(value))
    .map(([channel, value, unit]) => ({
      project_id: projectId,
      t,
      node: 'environment',
      channel,
      value,
      unit,
      quality: reading.quality ?? 'measured',
      solver: 'environment',
      source: provenance,
    }));
  if (Number.isFinite(reading.air_temperature_c)) {
    samples.push({
      project_id: projectId,
      t,
      node: 'environment',
      channel: 'env.air_temperature_c',
      value: reading.air_temperature_c,
      unit: 'C',
      quality: reading.quality ?? 'measured',
      solver: 'environment',
      source: provenance,
    });
  }
  samples.push({
    project_id: projectId,
    t,
    node: 'environment',
    channel: 'env.air_density_kg_m3',
    value: atmosphere.density,
    unit: 'kg/m^3',
    quality: 'derived',
    solver: 'environment',
    source: { method: atmosphere.model, model: 'ISA troposphere', measured_at: reading.observed_at ?? null },
  });
  return samples;
}

async function dispose(plan) {
  if (plan && typeof plan === 'object') plan.provider = null;
}

export const environmentSolver = { manifest, selfTest, prepare, run, dispose };