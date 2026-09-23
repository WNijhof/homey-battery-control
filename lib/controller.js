'use strict';

/**
 * Strategies (like Home Battery Control):
 *   off              – battery idle ("full stop")
 *   self_consumption – zero-grid: charge from surplus, discharge on import
 *   solar_only       – only charge from solar surplus, never discharge ("charge PV")
 *   zero_import      – only discharge to cover the house, never charge ("zero import")
 *   dynamic          – price plan; per period (cheap / neutral / expensive) a configurable action
 *   charge           – force charge at fixed power (optionally until a goal, then a follow-up strategy)
 *   discharge        – force discharge at fixed power (optionally until a goal, then a follow-up)
 *   peak_shaving     – idle, only acts when grid import/export exceeds the limits ("standby")
 *
 * On top of every strategy except "off", optional grid import/export limits are enforced
 * (peak shaving), like in Home Battery Control.
 */
const STRATEGIES = [
  'off', 'self_consumption', 'solar_only', 'zero_import', 'dynamic', 'charge', 'discharge', 'peak_shaving',
];

// Actions available per price period of the dynamic strategy
const DYNAMIC_ACTIONS = ['charge', 'solar_only', 'self_consumption', 'zero_import', 'sell', 'off'];

/**
 * Compute the new battery set-point in watts.
 * Positive = discharge to home, negative = charge.
 *
 * @param {object} s
 * @param {string} s.strategy
 * @param {string|null} s.planAction   charge | discharge | hold (dynamic strategy)
 * @param {number} s.batteryPower      current battery AC power (+ discharge / - charge)
 * @param {number} s.gridPower         P1 power (+ import / - export)
 * @param {number|null} s.soc
 * @param {number} [s.lastTarget]      last sent set-point (for the direction hysteresis)
 * @param {object} s.cfg               device settings
 * @returns {{ target: number, reason: string }}
 */
function computeTarget({
  strategy, planAction, batteryPower, gridPower, soc, lastTarget = 0, cfg,
}) {
  // Zero-grid proportional correction: move battery power by the grid error.
  const zeroGrid = (gridTarget = cfg.gridTarget) => batteryPower + cfg.gain * (gridPower - gridTarget);

  const actionTarget = (action) => {
    switch (action) {
      case 'charge': return -cfg.maxChargeW;
      case 'sell': return cfg.maxDischargeW;
      case 'self_consumption': return zeroGrid();
      case 'solar_only': return Math.min(0, zeroGrid());
      case 'zero_import': return Math.max(0, zeroGrid());
      case 'off':
      default: return 0;
    }
  };

  let target = 0;
  let reason = strategy;

  switch (strategy) {
    case 'self_consumption':
    case 'solar_only':
    case 'zero_import':
      target = actionTarget(strategy);
      break;
    case 'charge':
      target = -cfg.forceChargeW;
      break;
    case 'discharge':
      target = cfg.forceDischargeW;
      break;
    case 'peak_shaving':
      target = 0; // the grid limits below do the work
      break;
    case 'dynamic': {
      const period = { charge: 'dynLow', hold: 'dynNeutral', discharge: 'dynHigh' }[planAction];
      const action = period ? cfg[period] : 'self_consumption'; // no prices: self-consumption
      reason = `dynamic:${planAction || 'no-prices'}→${action}`;
      target = actionTarget(action);
      break;
    }
    case 'off':
    default:
      target = 0;
  }

  // Peak shaving on top of the strategy: keep grid import/export within the limits
  if (strategy !== 'off') {
    const importLimit = strategy === 'peak_shaving' ? cfg.peakThreshold : cfg.importLimit;
    const exportLimit = cfg.exportLimit;
    const expectedGrid = gridPower - (target - batteryPower);
    if (importLimit > 0 && expectedGrid > importLimit) {
      target += expectedGrid - importLimit;
      reason += ' +piek';
    } else if (exportLimit > 0 && expectedGrid < -exportLimit) {
      target -= -exportLimit - expectedGrid;
      reason += ' +exportgrens';
    }
  }

  // State-of-charge limits
  if (soc !== null && soc !== undefined) {
    if (target < 0 && soc >= cfg.maxSoc) { target = 0; reason += ' (vol)'; }
    if (target > 0 && soc <= cfg.minSoc) { target = 0; reason += ' (leeg)'; }
  }

  // Hardware limits
  target = Math.max(-cfg.maxChargeW, Math.min(cfg.maxDischargeW, target));

  // Direction hysteresis: only reverse between charging and discharging for a clear demand
  if (cfg.switchHysteresis > 0 && lastTarget !== 0 && Math.sign(target) === -Math.sign(lastTarget)
    && Math.abs(target) < cfg.switchHysteresis) {
    target = 0;
  }

  // Tiny set-points are not worth switching for
  if (Math.abs(target) < cfg.minPower) target = 0;

  return { target: Math.round(target), reason };
}

/**
 * Decide whether a new set-point should actually be sent to the battery.
 */
function shouldSend(target, last, now, cfg) {
  if (!last) return true;
  if (Math.sign(target) !== Math.sign(last.target)) return true;
  if (Math.abs(target - last.target) >= cfg.deadband) return true;
  return now - last.time > 60 * 1000; // keep-alive
}

/**
 * Goal reached for a goal-driven strategy? Returns the follow-up strategy, or null.
 */
function goalFollowUp(strategy, soc, cfg) {
  if (soc === null || soc === undefined) return null;
  if (strategy === 'charge' && cfg.chargeGoalSoc && soc >= cfg.chargeGoalSoc) return cfg.followUp;
  if (strategy === 'discharge' && cfg.dischargeGoalSoc && soc <= cfg.dischargeGoalSoc) return cfg.followUp;
  return null;
}

module.exports = {
  STRATEGIES, DYNAMIC_ACTIONS, computeTarget, shouldSend, goalFollowUp,
};
