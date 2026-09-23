'use strict';

// Quick sanity tests: node test/planner.test.js  (fetches live prices)
const assert = require('assert');
const PriceService = require('../lib/prices');
const { makePlan } = require('../lib/planner');
const { computeTarget } = require('../lib/controller');

const cfg = {
  capacityKwh: 2.4, minSoc: 10, maxSoc: 100, maxChargeW: 800, maxDischargeW: 800,
  efficiency: 0.85, minSpread: 0.05, markup: 0.13, gridTarget: 20, gain: 0.7,
  deadband: 25, minPower: 30, forceChargeW: 800, forceDischargeW: 800, peakThreshold: 2500,
  avgLoadW: 500, dynLow: 'charge', dynNeutral: 'solar_only', dynHigh: 'self_consumption',
  importLimit: 0, exportLimit: 0, switchHysteresis: 0,
};

(async () => {
  // --- controller: zero-grid simulation (house 600 W, battery reacts instantly)
  let bat = 0;
  for (let i = 0; i < 12; i++) {
    const grid = 600 - bat;
    bat = computeTarget({
      strategy: 'self_consumption', planAction: null, batteryPower: bat, gridPower: grid, soc: 50, cfg,
    }).target;
  }
  assert(Math.abs(600 - bat - cfg.gridTarget) < 40, `zero-grid converges (bat=${bat})`);
  console.log(`zero-grid converged: battery ${bat} W, grid ${600 - bat} W`);

  // solar surplus: -1500 W export -> charge
  const solar = computeTarget({
    strategy: 'solar_only', planAction: null, batteryPower: 0, gridPower: -1500, soc: 50, cfg,
  });
  assert(solar.target < 0, 'solar_only charges on export');
  const noDis = computeTarget({
    strategy: 'solar_only', planAction: null, batteryPower: 0, gridPower: 800, soc: 50, cfg,
  });
  assert.strictEqual(noDis.target, 0, 'solar_only never discharges');
  const empty = computeTarget({
    strategy: 'discharge', planAction: null, batteryPower: 0, gridPower: 800, soc: 10, cfg,
  });
  assert.strictEqual(empty.target, 0, 'respects min SoC');
  console.log('controller tests ok');

  // --- planner on live prices
  const prices = new PriceService();
  await prices.refresh();
  const slots = prices.futureSlots();
  assert(slots.length > 0, 'prices available');
  const plan = makePlan(slots, cfg);
  const count = (a) => plan.slots.filter((s) => s.action === a).length;
  console.log(`\n${slots.length} future slots, discharge threshold €${plan.dischargeThreshold.toFixed(3)}`);
  console.log(`charge: ${count('charge')}, discharge: ${count('discharge')}, hold: ${count('hold')}\n`);
  const fmt = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', weekday: 'short', hour: '2-digit', minute: '2-digit' });
  for (const s of plan.slots.filter((_, i) => i % 4 === 0)) {
    const bar = '#'.repeat(Math.max(0, Math.round(s.price * 100)));
    console.log(`${fmt.format(new Date(s.start))}  €${s.price.toFixed(3)}  ${s.action.padEnd(9)} ${bar}`);
  }
})().catch((err) => { console.error(err); process.exit(1); });
