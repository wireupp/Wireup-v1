/**
 * Goal parsing, phase v09.
 *
 * A goal in plain language becomes a structured, checkable form BEFORE anything is built. There
 * are no question cards and no human in the loop: every thing the goal left unsaid becomes an
 * explicit, reported ASSUMPTION with a confidence, and the run proceeds on it.
 *
 * The one thing a goal must have is a number. "Make it fast" is refused with
 * `GOAL_NOT_MEASURABLE` and a concrete suggestion of what could be measured instead, because a
 * goal the platform cannot check is a goal it can only appear to have met.
 */

export const DOMAINS = ['electronics', 'mechanics', 'software', 'hybrid'];

const MECHANICS_WORDS = /\b(boat|hull|water|thrust|thruster|drone|rotor|hover|altitude|wind|keel|sail|airspeed|rigid.?body)\b/i;
const SOFTWARE_WORDS = /\b(website|web ?app|webapp|page|dashboard|html|css|script|laptop|computer|dom)\b/i;
const ELECTRONICS_WORDS = /\b(blink|led|arduino|uno|nano|mega|pico|esp32|resistor|capacitor|sensor|firmware|hz)\b/i;

const METRIC_PATTERNS = [
  {
    channel: 'hull.speed_surge_mps',
    unit: 'm/s',
    direction: 'target',
    pattern: /(\d+(?:\.\d+)?)\s*m\s*\/\s*s/i,
    metric: 'mean',
    domain: 'mechanics',
    description: 'steady-state surge speed of the hull',
  },
  {
    channel: 'body.position.z',
    unit: 'm',
    direction: 'target',
    pattern: /hover(?:s|ing)?\s+(?:at\s+)?(\d+(?:\.\d+)?)\s*m/i,
    metric: 'mean',
    domain: 'mechanics',
    description: 'held altitude',
  },
  {
    channel: 'web.load_ms',
    unit: 'ms',
    direction: 'max',
    pattern: /(?:within|in|under)\s+(\d+(?:\.\d+)?)\s*(?:s|sec|seconds?)\b/i,
    metric: 'mean',
    domain: 'software',
    scale: 1000,
    description: 'time to serve the page',
  },
  {
    channel: 'web.http_status',
    unit: null,
    direction: 'target',
    pattern: /loads?\s+with\s+(?:an?\s+)?(?:http\s*)?(\d{3})\b/i,
    metric: 'max',
    domain: 'software',
    description: 'HTTP status of the served page',
  },
  {
    channel: 'pin.duty_cycle',
    unit: 'ratio',
    direction: 'target',
    pattern: /(\d+(?:\.\d+)?)\s*hz/i,
    metric: 'mean',
    domain: 'electronics',
    description: 'measured blink frequency',
  },
];

export class GoalNotMeasurable extends Error {
  constructor(message, suggestion) {
    super(message);
    this.name = 'GoalNotMeasurable';
    this.code = 'GOAL_NOT_MEASURABLE';
    this.suggestion = suggestion;
  }
}

/**
 * Parse a goal.
 * @param {string} text
 * @returns {import('./types.js').ParsedGoal}
 */
export function parseGoal(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new GoalNotMeasurable('A goal must be a nonempty string.',
      'For example: "a boat that holds 1.2 m/s in water".');
  }
  const raw = text.trim();
  const domain = detectDomain(raw);
  const metrics = METRIC_PATTERNS
    .filter((candidate) => domain === 'hybrid' || candidate.domain === domain)
    .flatMap((candidate) => toMetrics(raw, candidate));

  if (!metrics.length) {
    throw new GoalNotMeasurable(
      `The goal "${raw}" contains no quantity this platform can measure.`,
      suggestionFor(domain),
    );
  }

  return {
    raw,
    domain,
    deliverables: deliverablesFor(raw, domain),
    metrics,
    constraints: constraintsFor(raw),
    environment: environmentFor(raw, domain),
    ambiguities: ambiguitiesFor(raw, domain),
  };
}

function detectDomain(raw) {
  const scores = [
    ['mechanics', MECHANICS_WORDS.test(raw)],
    ['software', SOFTWARE_WORDS.test(raw)],
    ['electronics', ELECTRONICS_WORDS.test(raw)],
  ].filter(([, hit]) => hit);
  if (scores.length === 0) return 'electronics';
  if (scores.length === 1) return scores[0][0];
  // "hybrid" only when both a physical and a computational target are named.
  if (scores.length === 2) return 'hybrid';
  return scores[0][0];
}

function toMetrics(raw, candidate) {
  const match = candidate.pattern.exec(raw);
  if (!match) return [];
  const magnitude = Number(match[1]) * (candidate.scale ?? 1);
  if (!Number.isFinite(magnitude)) return [];
  const tolerance = toleranceFor(raw, candidate, magnitude);
  return [{
    channel: candidate.channel,
    metric: candidate.metric,
    direction: candidate.direction,
    target: magnitude,
    tolerance,
    unit: candidate.unit,
    description: candidate.description,
    window: windowFor(raw),
  }];
}

/** "±5%" wins over an absolute tolerance; otherwise 10% for a target and 0 for a max. */
// "±", "+/-" and "+-" all mean the same thing to a person and none is worth rejecting a goal over.
const PLUS_MINUS = '(?:±|\\+/-|\\+-)';
function toleranceFor(raw, candidate, target) {
  const percent = new RegExp(`${PLUS_MINUS}\\s*(\\d+(?:\\.\\d+)?)\\s*%`).exec(raw);
  if (percent) return Math.abs(target) * (Number(percent[1]) / 100);
  const absolute = new RegExp(`${PLUS_MINUS}\\s*(\\d+(?:\\.\\d+)?)\\s*(m/s|m|s|ms|hz)?\\b`, 'i').exec(raw);
  if (absolute && absolute[2]) return Number(absolute[1]);
  return candidate.direction === 'max' ? 0 : Math.abs(target) * 0.1;
}

/** "over 20 s" / "for 20 s" bounds the measurement window; the window is the final 30% by default. */
function windowFor(raw) {
  const over = /(?:over|for|during|across)\s+(\d+(?:\.\d+)?)\s*s\b/i.exec(raw);
  if (!over) return null;
  const duration = Number(over[1]);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return { duration_s: duration, steady_fraction: 0.3 };
}

function constraintsFor(raw) {
  const constraints = {};
  const budget = /(?:budget|under|within|below|max(?:imum)?)\s*[$€£]?\s*(\d+(?:\.\d+)?)/i.exec(raw);
  if (budget && /[$€£]/.test(budget[0])) constraints.budget = Number(budget[1]);
  const parts = /(\d+)\s*parts?\b/i.exec(raw);
  if (parts) constraints.parts = Number(parts[1]);
  const banned = /no\s+([a-z ]{3,40}?)(?:[.;,]|$)/i.exec(raw);
  if (banned) constraints.banned_kinds = banned[1].trim().split(/\s+/);
  return constraints;
}

function environmentFor(raw, domain) {
  const environment = {};
  if (domain === 'mechanics' || /\bwater|sea|lake|river|air|wind|sky|ground\b/i.test(raw)) {
    environment.water = /\bwater|sea|lake|river|boat|hull\b/i.test(raw) ? 'still' : undefined;
    environment.weather = /\bwind|weather|rain|gust\b/i.test(raw) ? 'recorded' : undefined;
  }
  if (Object.values(environment).every((value) => value === undefined)) return undefined;
  return environment;
}

function deliverablesFor(raw, domain) {
  const deliverables = [];
  if (domain === 'mechanics') deliverables.push('a simulated hull or airframe with a measured result');
  if (domain === 'software') deliverables.push('a served web app with probed DOM assertions');
  if (domain === 'electronics') deliverables.push('a wired board with measured telemetry');
  if (/\bbom|build list|parts\b/i.test(raw)) deliverables.push('a priced build list');
  return deliverables;
}

/**
 * The assumption log that replaces the old agent's ten mandatory questions.
 *
 * Each entry says what was assumed, why, and how confident the parser is. These are surfaced
 * verbatim in the final report — they are the difference between an agent that guessed quietly
 * and one that guessed out loud.
 */
function ambiguitiesFor(raw, domain) {
  const entries = [];
  if (domain === 'mechanics') {
    entries.push({
      question: 'What water should the hull float in?',
      assumption: 'Still fresh water at 1000 kg/m^3 with no current, unless the goal says otherwise.',
      why: 'No goal states a fluid. Density changes the displacement, so it is recorded rather than defaulted silently.',
      confidence: 0.7,
    });
    entries.push({
      question: 'Which thruster performance should be assumed?',
      assumption: 'The thruster transfer curve declared on the node, not a motor datasheet.',
      why: 'Headless firmware execution is unavailable, so no motor model can be measured; the declared gain is used and reported as an assumption.',
      confidence: 0.5,
    });
    entries.push({
      question: 'Should the platform compensate for wind and waves?',
      assumption: 'Flat water, steady wind of 0 m/s unless the goal names weather.',
      why: 'A moving free surface changes resistance discontinuously; assuming calm water is the reproducible choice.',
      confidence: 0.6,
    });
  }
  if (domain === 'software') {
    entries.push({
      question: 'How should the page be measured?',
      assumption: 'A loopback fetch of the declared entry document plus static DOM assertions.',
      why: 'No browser renderer runs inside the sandbox, so a real page-load metric is not available.',
      confidence: 0.6,
    });
  }
  if (domain === 'electronics') {
    entries.push({
      question: 'How will firmware be executed?',
      assumption: 'No headless MCU runtime is available, so electronics goals are reported unverified.',
      why: 'The headless runtime worker is blocked on an OS-level network boundary that this platform does not have.',
      confidence: 0.9,
    });
  }
  if (!/\b\d/.test(raw)) {
    entries.push({
      question: 'What does "good" mean numerically?',
      assumption: 'The first numeric quantity in the goal is the objective.',
      why: 'Only one number is present, so it is the only measurable candidate.',
      confidence: 0.4,
    });
  }
  return entries;
}

function suggestionFor(domain) {
  if (domain === 'mechanics') {
    return 'State a speed, altitude or thrust in the goal, for example "a boat that holds 1.2 m/s in water".';
  }
  if (domain === 'software') {
    return 'State a time or a status, for example "a web app that loads within 2 s".';
  }
  return 'State a frequency, a time or a voltage, for example "an LED that blinks at exactly 1 Hz".';
}