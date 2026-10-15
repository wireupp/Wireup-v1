/**
 * The build list, phase v09.
 *
 * This is the artefact a human actually receives, and its trustworthiness comes from what it
 * refuses to say:
 *
 *   - Every verification row carries a `trial_id` and a `quality`. A row whose quality is not
 *     `measured` is labelled NOT PHYSICALLY VERIFIED in the rendered form.
 *   - `bom_total` counts UNPRICED items and names its price source. A price that cannot be
 *     traced to a named source is never printed. "Never fabricate a price" is a hard rule, not
 *     a default.
 *   - `status: "verified"` requires every goal metric to pass with quality `measured`.
 *   - `assembly` steps always say what the power state must be. "Disconnect power before
 *     wiring" is the default, matching the in-app build guide.
 *   - `unmet` is non-empty whenever the status is not `verified`.
 */

import { bomOf } from '../../packages/core/graph/selectors.mjs';

/**
 * @param {object} input
 * @param {object} input.goal ParsedGoal
 * @param {string} input.status
 * @param {object} input.graph the graph as it stands
 * @param {number} input.revision
 * @param {object[]} input.verdicts
 * @param {object[]} input.risks
 * @param {object|null} input.infeasible
 * @param {object} input.budget
 * @param {object[]} input.artifacts
 */
export function buildReport({
  goal, status, graph, revision, verdicts, risks, infeasible, budget, artifacts = [], iterations = 0,
  blocked = null,
}) {
  const bom = buildBom(graph);
  const unmet = buildUnmet({ verdicts, infeasible, risks, blocked });
  return {
    goal,
    status,
    project_id: graph.project_id ?? graph.id,
    graph_revision: revision,
    bom: bom.lines,
    bom_total: bom.total,
    wiring: buildWiring(graph),
    assembly: buildAssembly(graph),
    firmware: {
      filename: null,
      language: 'declared control law',
      source: null,
      upload_steps: [],
      note: 'No compiled firmware is produced: headless firmware execution is unavailable. ' +
        'Actuator commands come from a declared control law or an open-loop PWM source.',
    },
    verification: verdicts,
    assumptions: goal.ambiguities,
    unmet,
    confidence: buildConfidence({ verdicts, budget, risks }),
    artifacts,
    budget,
    iterations,
  };
}

function buildBom(graph) {
  // `bomOf` already refuses to present a partial total as a total, which is exactly the rule
  // this report needs; reuse it rather than re-deriving prices a second way.
  const bom = bomOf(graph);
  const lines = bom.lines.map((line, index) => ({
    line_id: `L${index + 1}`,
    kind: line.node_kind,
    label: line.label,
    quantity: line.quantity,
    unit_price: line.unit_price,
    currency: line.unit_price === null ? null : 'USD',
    source: line.unit_price === null
      ? 'contracts/kinds.json (no price declared)'
      : 'contracts/kinds.json unit_price',
    substitute_for: null,
    in_stock_note: null,
    simulated: line.simulated,
  }));
  return {
    lines,
    total: {
      amount: bom.total?.amount ?? null,
      currency: bom.total?.currency ?? null,
      priced_items: bom.priced_items,
      unpriced_items: bom.unpriced_items,
      price_source: bom.priced_items ? 'contracts/kinds.json unit_price' : null,
      as_of: null,
      note: bom.priced_items === bom.lines.length && bom.lines.length
        ? null
        : `No complete price source is configured. ${bom.unpriced_items} of ${bom.lines.length} items are unpriced and no total is claimed.`,
    },
  };
}

function buildWiring(graph) {
  return (graph.edges ?? []).map((edge) => ({
    from: { node: edge.from.node, label: edge.from.node, port: edge.from.port },
    to: { node: edge.to.node, label: edge.to.node, port: edge.to.port },
    kind: edge.kind ?? null,
    note: null,
  }));
}

function buildAssembly(graph) {
  const steps = [
    {
      step: 1,
      instruction: 'Lay out every part on the bench and confirm each node id in this build list '
        + 'matches the physical part.',
      warnings: [],
      power_state_required: 'disconnect power',
    },
  ];
  let step = 2;
  for (const edge of graph.edges ?? []) {
    steps.push({
      step: step++,
      instruction: `Connect ${edge.from.node}.${edge.from.port} to ${edge.to.node}.${edge.to.port}.`,
      warnings: [],
      power_state_required: 'disconnect power',
    });
  }
  steps.push({
    step: step++,
    instruction: 'Check every connection against the wiring list above before applying power.',
    warnings: [],
    power_state_required: 'disconnect power',
  });
  return steps;
}

function buildUnmet({ verdicts, infeasible, risks, blocked }) {
  const unmet = [];
  if (blocked) {
    // A run that stopped early must say WHY in the deliverable. "Unverified" without a reason
    // is the failure mode this report exists to prevent.
    unmet.push({
      requirement: 'The run completes its experiment loop.',
      reason: `${blocked.code}: ${blocked.detail ?? 'the loop stopped.'}`,
      ...(blocked.action ? { required_to_support: `The classified action is: ${blocked.action}.` } : {}),
    });
  }
  if (infeasible) {
    unmet.push({
      requirement: 'The platform can execute this goal.',
      reason: infeasible.reason,
      required_to_support: infeasible.required_to_support,
    });
  }
  for (const verdict of verdicts) {
    if (verdict.pass && verdict.quality === 'measured') continue;
    unmet.push({
      requirement: `${verdict.channel} ${verdict.direction} ${verdict.target} ${verdict.unit ?? ''}`.trim(),
      reason: verdict.reason === 'NOT_MEASURED'
        ? `No measured value was recorded on channel '${verdict.channel}' (last quality: ${verdict.quality}).`
        : `Measured ${verdict.measured} ${verdict.unit ?? ''} against a target of ${verdict.target} `
          + `${verdict.unit ?? ''} with tolerance ${verdict.tolerance}.`,
      ...(verdict.trial_id ? { trial_id: verdict.trial_id } : {}),
    });
  }
  for (const risk of risks.filter((entry) => entry.blocking)) {
    unmet.push({ requirement: risk.description, reason: risk.description, required_to_support: risk.mitigation });
  }
  return unmet;
}

function buildConfidence({ verdicts, budget, risks }) {
  const basis = [];
  const measured = verdicts.filter((verdict) => verdict.quality === 'measured');
  basis.push({
    score: verdicts.length ? measured.length / verdicts.length : 0,
    why: `${measured.length} of ${verdicts.length} goal metrics were measured rather than assumed.`,
  });
  basis.push({
    score: budget.used.iterations > 0 ? 1 / budget.used.iterations : 0,
    why: `${budget.used.iterations} iteration(s) were used of ${budget.limits.max_iterations}.`,
  });
  for (const risk of risks) {
    basis.push({ score: risk.blocking ? 0 : 0.5, why: `${risk.blocking ? 'Blocking' : 'Non-blocking'} risk: ${risk.description}` });
  }
  return {
    score: basis.reduce((sum, entry) => sum + entry.score, 0) / Math.max(1, basis.length),
    basis,
  };
}

/** Render a report for a human. Kept next to the report so the two cannot drift apart. */
export function renderReport(report) {
  const lines = [];
  lines.push(`# Build report — ${report.status.toUpperCase()}`);
  lines.push('');
  lines.push(`Goal: ${report.goal.raw}`);
  lines.push(`Domain: ${report.goal.domain}   Project: ${report.project_id}   Revision: ${report.graph_revision}`);
  lines.push(`Iterations: ${report.iterations}   Tool calls: ${report.budget.used.tool_calls}`);
  lines.push('');
  lines.push('## Verification');
  if (!report.verification.length) lines.push('- (nothing was measured)');
  for (const row of report.verification) {
    const label = row.quality === 'measured' ? '' : '  **NOT PHYSICALLY VERIFIED**';
    lines.push(`- \`${row.channel}\`: ${row.measured ?? 'not measured'} ${row.unit ?? ''} `
      + `(target ${row.target} ${row.unit ?? ''} ±${row.tolerance}, ${row.reason})`
      + `${row.trial_id ? ` — trial \`${row.trial_id}\`` : ' — no trial'}${label}`);
  }
  lines.push('');
  lines.push('## Build list');
  for (const line of report.bom) {
    lines.push(`- ${line.quantity} × ${line.label} (\`${line.kind}\`)${line.simulated ? '' : ' — placement only'}`);
  }
  lines.push(`- **Total:** ${report.bom_total.amount === null
    ? `not claimed (${report.bom_total.unpriced_items} item(s) unpriced, no price source configured)`
    : `${report.bom_total.amount} ${report.bom_total.currency}`}`);
  lines.push('');
  lines.push('## Wiring');
  for (const wire of report.wiring) {
    lines.push(`- ${wire.from.node}.${wire.from.port} → ${wire.to.node}.${wire.to.port}`);
  }
  if (!report.wiring.length) lines.push('- (no edges)');
  lines.push('');
  lines.push('## Assembly');
  for (const step of report.assembly) {
    lines.push(`${step.step}. ${step.instruction} _(${step.power_state_required})_`);
  }
  lines.push('');
  lines.push('## Assumptions');
  for (const item of report.assumptions) {
    lines.push(`- **${item.question}** ${item.assumption} — ${item.why} (confidence ${item.confidence})`);
  }
  if (!report.assumptions.length) lines.push('- (none)');
  if (report.unmet.length) {
    lines.push('');
    lines.push('## Not met');
    for (const item of report.unmet) {
      lines.push(`- **${item.requirement}** — ${item.reason}`
        + `${item.required_to_support ? ` _Required to support: ${item.required_to_support}_` : ''}`);
    }
  }
  return `${lines.join('\n')}\n`;
}