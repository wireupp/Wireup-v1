/**
 * The pin-to-force bridge, phase v11. This is the coupling that makes the platform worth
 * building: a firmware PWM on a pin becomes a real force on a real body, and a physical
 * quantity becomes a telemetry channel the firmware can read back.
 *
 * Direction 1 (signal -> force)
 *   TelemetryBus sample on the actuator's signal channel
 *     -> declared transfer function (deadband, saturation, curve, gain, offset)
 *     -> mech.force / mech.torque / mech.angular applied to a rigid body.
 *
 * Direction 2 (physics -> telemetry)
 *   Body state (depth, attitude, angular rate, acceleration)
 *     -> declared sensor model
 *     -> a channel the firmware reads, so a control loop can close on physics.
 *
 * The transfer function is DECLARED DATA in contracts/kinds.json. A servo deadband is
 * modelled because it is declared, not approximated away because it is inconvenient.
 */

export const SIGNAL_MIN = 0;
export const SIGNAL_MAX = 1;

/**
 * Evaluate a declared transfer function at a normalised signal.
 *
 * @param {number} signal  normalised command, clamped to [0, 1]
 * @param {object} transfer { curve, deadband, saturation, gain, offset, invert, bidirectional }
 * @returns {{output:number, deadbanded:boolean, saturated:boolean}}
 */
export function applyTransfer(signal, transfer) {
  if (!Number.isFinite(signal)) {
    throw new TypeError('Actuator received a non-finite signal value.');
  }
  const spec = normaliseTransfer(transfer);
  const centred = spec.bidirectional ? clamp(signal * 2 - 1, -1, 1) : clamp(signal, 0, 1);
  const magnitude = Math.abs(centred);
  const deadbanded = magnitude <= spec.deadband;
  if (deadbanded) {
    return { output: 0, deadbanded: true, saturated: false, normalised: 0 };
  }
  // Remap so the deadband edge maps to 0 rather than jumping to deadband/gain.
  const span = 1 - spec.deadband;
  const normalised = (magnitude - spec.deadband) / span;
  const shaped = spec.curve === 'quadratic'
    ? normalised * normalised
    : spec.curve === 'cubic'
      ? normalised * normalised * normalised
      : normalised;
  const saturated = shaped >= spec.saturation;
  const limited = saturated ? spec.saturation / 1 : shaped;
  const signed = (spec.invert ? -1 : 1) * Math.sign(centred || 1) * limited;
  return {
    output: signed * spec.gain,
    deadbanded: false,
    saturated,
    normalised: signed * (saturated ? spec.saturation / shaped : 1),
  };
}

function normaliseTransfer(transfer) {
  if (!transfer || typeof transfer !== 'object') {
    throw new TypeError('An actuator needs a declared transfer function.');
  }
  if (!Number.isFinite(transfer.gain)) {
    throw new TypeError('An actuator transfer function needs a declared finite gain.');
  }
  const deadband = Number.isFinite(transfer.deadband) ? transfer.deadband : 0;
  const saturation = Number.isFinite(transfer.saturation) ? transfer.saturation : 1;
  if (deadband < 0 || deadband >= 1) throw new TypeError('Transfer deadband must be in [0, 1).');
  if (saturation <= 0 || saturation > 1) throw new TypeError('Transfer saturation must be in (0, 1].');
  const curve = transfer.curve ?? 'linear';
  if (!['linear', 'quadratic', 'cubic'].includes(curve)) {
    throw new TypeError(`Unknown actuator transfer curve '${curve}'.`);
  }
  return {
    gain: transfer.gain,
    deadband,
    saturation,
    curve,
    invert: Boolean(transfer.invert),
    bidirectional: Boolean(transfer.bidirectional),
  };
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/**
 * A control loop is part of the honest model, not part of the fiction.
 *
 * The bench case that closes the loop on a barometer does not hand the solver a magic
 * "depth -> thrust" law. It declares a P controller with a gain and a setpoint, and the
 * solver runs it on declared physics. `clamp` stops the integral windup.
 */
export function proportionalController({ setpoint, measured, gain, integral_gain = 0, min = -1, max = 1, dt = 0 }) {
  const error = setpoint - measured;
  const integral = clamp(integral_gain * error * dt, min, max);
  return clamp(gain * error + integral, min, max);
}

/**
 * Map a body state to a declared sensor reading.
 *
 * barometer: p = p_surface + rho * g * depth, exact hydrostatics for a submerged body.
 * imu:       specific force = a - g_hat, i.e. what an accelerometer on the body reads.
 * depth:     surface_z - body.z, positive below the surface.
 */
export function sensorReading(kind, body, environment) {
  switch (kind) {
    case 'depth': {
      const surface = environment?.surface_z ?? 0;
      // A declared `datum` is the height of the sensor above the body origin, so a hull's
      // draft sensor reports KEEL depth rather than the depth of an arbitrary origin. It is
      // declared on the node; it is never inferred.
      const datum = Number.isFinite(environment?.datum) ? environment.datum : 0;
      return {
        value: surface - (body.position.z - datum),
        unit: 'm',
        quality: 'measured',
        model: 'depth below the declared surface, from the declared datum',
      };
    }
    case 'altitude': {
      const datum = environment?.ground_z ?? 0;
      return {
        value: body.position.z - datum,
        unit: 'm',
        quality: 'measured',
        model: 'height above the declared ground datum',
      };
    }
    case 'barometer': {
      const density = environment?.density ?? 1000;
      const gravity = environment?.gravity ?? 9.80665;
      const surface = environment?.surface_z ?? 0;
      const datum = Number.isFinite(environment?.datum) ? environment.datum : 0;
      const depth = Math.max(0, surface - (body.position.z - datum));
      return {
        value: (environment?.surface_pressure_pa ?? 101325) + density * gravity * depth,
        unit: 'Pa',
        quality: 'measured',
        model: 'hydrostatic p = p0 + rho*g*h',
      };
    }
    case 'imu': {
      const acceleration = body.force.z / body.mass;
      const value = acceleration - (environment?.gravity ?? 9.80665);
      return { value, unit: 'm/s^2', quality: 'measured', model: 'specific force a - g' };
    }
    case 'compass': {
      return {
        value: Math.atan2(body.orientation.y, body.orientation.w),
        unit: 'rad',
        quality: 'derived',
        model: 'yaw from quaternion',
      };
    }
    default:
      throw Object.assign(
        new Error(`Sensor kind '${kind}' has no declared model.`),
        { code: 'SENSOR_MODEL_UNAVAILABLE' },
      );
  }
}

/**
 * The signal bus.
 *
 * Keyed by CHANNEL, not by node: an actuator, a rotor or a control law asks for "the value on
 * esc.pwm", not for "whatever node happens to be first in the graph". Keying by node would
 * make two actuators reading one PWM line behave differently for no reason a graph author
 * could see.
 *
 * Signals arrive as ordinary telemetry from the firmware lane; the bus never reads firmware
 * memory or a DOM pin. If no sample arrived for this step, the actuator holds its LAST
 * commanded value rather than snapping to zero: a real ESC latches.
 */
export class ActuatorBus {
  constructor() {
    this.state = new Map();
  }

  command(channel, { signal, source, t }) {
    const previous = this.state.get(channel);
    this.state.set(channel, {
      channel,
      signal,
      source: source ?? 'firmware',
      t,
      // Explicitly recorded so a report can say whether a force was commanded live or held.
      latched: Boolean(previous && previous.signal === signal),
    });
  }

  read(channel) {
    return this.state.get(channel) ?? null;
  }

  entries() {
    return [...this.state.values()];
  }
}