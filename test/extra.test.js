'use strict';

// node test/extra.test.js  (offline tests for entsoe, forecast, planner+solar, stats)
const assert = require('assert');
const { parseEntsoe } = require('../lib/entsoe');
const { SolarForecast, localToUtc } = require('../lib/forecast');
const { makePlan } = require('../lib/planner');
const { savingsDelta, learnedEfficiency } = require('../lib/stats');

// ---- ENTSO-E: hourly with an omitted position (A03 curve) -> 4 quarters each
const xml = `<Publication_MarketDocument><TimeSeries><Period>
  <timeInterval><start>2026-09-22T22:00Z</start><end>2026-09-23T01:00Z</end></timeInterval>
  <resolution>PT60M</resolution>
  <Point><position>1</position><price.amount>100</price.amount></Point>
  <Point><position>3</position><price.amount>-10.5</price.amount></Point>
</Period></TimeSeries></Publication_MarketDocument>`;
const e = parseEntsoe(xml);
assert.strictEqual(e.length, 12, 'three hours = 12 quarters');
assert.strictEqual(e[0].start, Date.parse('2026-09-22T22:00Z'));
assert(Math.abs(e[4].price - 0.121) < 1e-9, 'position 2 omitted -> repeats 100 EUR/MWh incl. VAT');
assert(Math.abs(e[8].price - (-10.5 / 1000) * 1.21) < 1e-9, 'negative price');
console.log('entsoe ok');

// ---- time zone conversion (summer +2, winter +1)
assert.strictEqual(localToUtc('2026-09-23 12:00:00', 'Europe/Amsterdam'), Date.parse('2026-09-23T10:00:00Z'));
assert.strictEqual(localToUtc('2026-12-23 12:00:00', 'Europe/Amsterdam'), Date.parse('2026-12-23T11:00:00Z'));
console.log('timezone ok');

// ---- forecast interpolation and night gap
const f = new SolarForecast();
f.setWatts({
  '2026-09-23 07:30:00': 0, '2026-09-23 12:00:00': 2000, '2026-09-23 19:30:00': 0,
  '2026-09-24 07:30:00': 0, '2026-09-24 12:00:00': 1000,
});
assert(Math.abs(f.wattsAt(Date.parse('2026-09-23T10:00:00Z')) - 2000) < 1, 'noon value');
assert.strictEqual(f.wattsAt(Date.parse('2026-09-23T23:00:00Z')), 0, 'night gap = 0');
console.log('forecast ok');

// ---- planner: sunny day replaces night-time grid charging
const base = Date.parse('2026-09-23T22:00:00Z'); // 00:00 local
const slots = [];
for (let i = 0; i < 96; i++) {
  const hour = i / 4;
  let price = 0.20;
  if (hour >= 2 && hour < 5) price = 0.08; // cheap night
  if (hour >= 18 && hour < 21) price = 0.35; // evening peak
  slots.push({ start: base + i * 900000, end: base + (i + 1) * 900000, price });
}
const opts = {
  capacityKwh: 2.4, minSoc: 10, maxSoc: 100, maxChargeW: 800, maxDischargeW: 800,
  efficiency: 0.85, minSpread: 0.05, markup: 0.13, avgLoadW: 500, soc: 10,
};
const count = (p, a) => p.slots.filter((s) => s.action === a).length;
const cloudy = makePlan(slots, opts);
const sunny = makePlan(slots, {
  ...opts,
  solarSurplusW: (start) => {
    const h = ((start - base) / 3600000) % 24;
    return h >= 10 && h < 16 ? 1500 : 0;
  },
});
console.log(`planner: cloudy ${count(cloudy, 'charge')} charge slots, sunny ${count(sunny, 'charge')}`);
assert(count(cloudy, 'charge') >= 3, 'cloudy day: grid charging at night');
assert(count(sunny, 'charge') < count(cloudy, 'charge') && count(sunny, 'charge') <= 3, 'sunny day: only the morning needs grid energy');
const full = makePlan(slots, { ...opts, soc: 100 });
assert(count(full, 'charge') < count(cloudy, 'charge'), 'full battery buys less grid energy');
console.log('planner+solar ok');

// ---- controller: strategies from Home Battery Control
{
  const { computeTarget, goalFollowUp } = require('../lib/controller');
  const cfg = {
    gridTarget: 0, gain: 1, maxChargeW: 800, maxDischargeW: 800, minSoc: 10, maxSoc: 100, minPower: 30,
    forceChargeW: 800, forceDischargeW: 800, peakThreshold: 2500, importLimit: 0, exportLimit: 0,
    switchHysteresis: 0, dynLow: 'charge', dynNeutral: 'solar_only', dynHigh: 'self_consumption',
    chargeGoalSoc: 80, dischargeGoalSoc: 20, followUp: 'self_consumption',
  };
  const t = (o) => computeTarget({ batteryPower: 0, soc: 50, planAction: null, ...o, cfg: { ...cfg, ...o.cfg } }).target;

  assert.strictEqual(t({ strategy: 'zero_import', gridPower: 500 }), 500, 'zero import discharges on import');
  assert.strictEqual(t({ strategy: 'zero_import', gridPower: -500 }), 0, 'zero import never charges');
  assert.strictEqual(t({ strategy: 'dynamic', planAction: 'hold', gridPower: 500 }), 0, 'neutral = solar only');
  assert.strictEqual(t({ strategy: 'dynamic', planAction: 'hold', gridPower: 500, cfg: { dynNeutral: 'self_consumption' } }), 500,
    'neutral = self-consumption when configured');
  assert.strictEqual(t({ strategy: 'dynamic', planAction: 'discharge', gridPower: 100, cfg: { dynHigh: 'sell' } }), 800, 'sell');
  assert.strictEqual(t({ strategy: 'peak_shaving', gridPower: 2000 }), 0, 'standby below the limit');
  assert.strictEqual(t({ strategy: 'peak_shaving', gridPower: 3000 }), 500, 'shave above the limit');
  assert.strictEqual(t({ strategy: 'solar_only', gridPower: 3000, cfg: { importLimit: 2500 } }), 500,
    'import limit on top of another strategy');
  assert.strictEqual(t({ strategy: 'zero_import', gridPower: -2000, cfg: { exportLimit: 1500 } }), -500,
    'export limit charges extra');
  assert.strictEqual(t({ strategy: 'off', gridPower: 5000, cfg: { importLimit: 2500 } }), 0, 'off = really off');
  assert.strictEqual(t({ strategy: 'self_consumption', gridPower: -100, lastTarget: 300, cfg: { switchHysteresis: 150 } }), 0,
    'hysteresis: no small reversal');
  assert.strictEqual(t({ strategy: 'self_consumption', gridPower: -400, lastTarget: 300, cfg: { switchHysteresis: 150 } }), -400,
    'hysteresis: clear reversal allowed');
  assert.strictEqual(goalFollowUp('charge', 80, cfg), 'self_consumption', 'charge goal reached');
  assert.strictEqual(goalFollowUp('charge', 79, cfg), null);
  assert.strictEqual(goalFollowUp('discharge', 20, cfg), 'self_consumption', 'discharge goal reached');
  console.log('strategies ok');
}

// ---- stats
assert(Math.abs(savingsDelta(800, 1, 0.30) - 0.24) < 1e-9, 'discharge 0.8 kWh at 0.30 = +0.24');
assert(Math.abs(savingsDelta(-800, 1, 0.10) + 0.08) < 1e-9, 'charge 0.8 kWh at 0.10 = -0.08');
assert.strictEqual(savingsDelta(800, 1, null), 0, 'no price, no savings');
const snaps = [
  { charged: 0, discharged: 0, soc: 50 },
  { charged: 10, discharged: 8.5, soc: 50 },
];
assert(Math.abs(learnedEfficiency(snaps, 2.4) - 0.85) < 1e-9, 'efficiency 85 %');
assert.strictEqual(learnedEfficiency([{ charged: 0, discharged: 0, soc: 50 }, { charged: 2, discharged: 1, soc: 50 }], 2.4), null,
  'too little data');
console.log('stats ok');
