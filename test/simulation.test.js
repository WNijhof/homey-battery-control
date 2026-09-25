'use strict';

// Simulated battery (SolarFlow 2400 AC+ model) and the comparison with/without battery:
// node test/simulation.test.js
const assert = require('assert');
const Module = require('module');
const { SimulatedBattery } = require('../lib/batteries/simulator');
const { SimulationStats } = require('../lib/simstats');
const { SimTrace } = require('../lib/simtrace');

const H = 3600 * 1000;

function battery(opts = {}) {
  let t = 0;
  const b = new SimulatedBattery({ now: () => t, minSoc: 10, ...opts });
  b.clock = { set: (v) => { t = v; }, get: () => t };
  return b;
}

/** Run at a fixed set-point until the battery stops (full/empty), return elapsed seconds. */
async function runUntilStopped(b, watts) {
  await b.setPower(watts);
  const start = b.clock.get();
  for (let i = 0; i < 48 * 3600; i += 10) {
    b.clock.set(b.clock.get() + 10000);
    const r = await b.read();
    if (i > 60 && r.batteryPower !== Math.round(watts) && Math.abs(r.batteryPower) < 2) break;
  }
  return (b.clock.get() - start) / 1000;
}

async function roundTrip(power) {
  const b = battery({ soc: 10, standbyW: 0, idleDrainW: 0 });
  await runUntilStopped(b, -power);
  assert(b.soc() > 99.9, `full after charging at ${power} W (${b.soc()})`);
  const acIn = b.totals.acInWh;
  await runUntilStopped(b, power);
  assert(Math.abs(b.soc() - 10) < 0.2, `back at min soc after discharging (${b.soc()})`);
  return (b.totals.acOutWh / acIn);
}

(async () => {
  // round trip efficiency at 800 W (reviews: 87–88 %), lower at small powers (reviews: 78–82 % at 100–200 W)
  const rte800 = await roundTrip(800);
  assert(rte800 > 0.86 && rte800 < 0.89, `RTE 800 W = ${rte800}`);
  const rte150 = await roundTrip(150);
  assert(rte150 > 0.78 && rte150 < 0.83, `RTE 150 W = ${rte150}`);
  console.log(`RTE 800 W: ${(rte800 * 100).toFixed(1)} %, 150 W: ${(rte150 * 100).toFixed(1)} %`);

  // response: nothing happens during the delay, then a ramp of 200 W/s
  let b = battery({ soc: 50 });
  await b.setPower(-800);
  b.clock.set(2000);
  assert.strictEqual((await b.read()).batteryPower, -1, 'still idle (standby draw) during the response delay');
  b.clock.set(5000);
  const ramp = (await b.read()).batteryPower;
  assert(ramp <= -400 && ramp >= -600, `ramping after the delay (${ramp})`);
  b.clock.set(10000);
  assert.strictEqual((await b.read()).batteryPower, -800, 'full power after the ramp');

  // standby: 2.7 W from the cells for a day ≈ 65 Wh ≈ 2.7 % of 2.4 kWh
  b = battery({ soc: 50 });
  b.clock.set(24 * H);
  const r = await b.read();
  assert(Math.abs(r.socExact - (50 - 2.7)) < 0.05, `idle drain over a day (${r.socExact})`);

  // after an app restart the time in between counts as idle
  let t = 48 * H;
  b = new SimulatedBattery({ now: () => t, soc: 50, since: 0 });
  assert(Math.abs((await b.read()).socExact - (50 - 5.4)) < 0.05, 'idle drain while the app was stopped');

  // charging tapers near full, and stops at max soc; discharging stops at min soc
  b = battery({ soc: 98 });
  assert(b.chargeLimit() < 400, `taper at 98 % (${b.chargeLimit()})`);
  b = battery({ soc: 10.05 });
  await runUntilStopped(b, 800);
  assert(b.soc() > 9.9, 'never below min soc');

  // state is saved while running and on close
  const saved = [];
  t = 0;
  b = new SimulatedBattery({ now: () => t, soc: 50, onState: (s) => saved.push(s) });
  t = 61000;
  await b.read();
  b.close();
  assert.strictEqual(saved.length, 2, 'state saved every minute and on close');

  // --- comparison bookkeeping
  const stats = new SimulationStats({ formatDate: () => '01-06-2026' });
  // one hour: 1000 W export without battery, battery charges 800 W → only 200 W export remains
  stats.add({ t: 0, realGrid: -1000, batteryPower: -800, price: 0.3, exportPrice: 0.1, soc: 50 });
  stats.add({ t: 0.05 * H, realGrid: -1000, batteryPower: -800, price: 0.3, exportPrice: 0.1, soc: 50 });
  stats.add({ t: 0.1 * H, realGrid: -1000, batteryPower: -800, price: 0.3, exportPrice: 0.1, soc: 55 });
  // then 0.1 h: 500 W import, battery discharges 500 W
  stats.add({ t: 0.2 * H, realGrid: 500, batteryPower: 500, price: 0.3, exportPrice: 0.1, soc: 50 });
  const s = SimulationStats.summary(stats.total, 2.4);
  const near = (a, e) => Math.abs(a - e) < 1e-6;
  assert(near(s.realExport, 0.1) && near(s.simExport, 0.02), `export ${s.realExport} → ${s.simExport}`);
  assert(near(s.solarCharged, 0.08) && near(s.gridCharged, 0), 'charged from solar');
  assert(near(s.realImport, 0.05) && near(s.simImport, 0) && near(s.dischargeHome, 0.05), 'import covered');
  // with net metering: charging costs what the export would have earned (0.08 × 0.3), discharge saves 0.05 × 0.3
  assert(near(stats.total.costReal - stats.total.costSim, -0.08 * 0.3 + 0.05 * 0.3), 'savings with net metering');
  // without: charging only costs the lost export at 0.1 → much better
  assert(near(stats.total.costRealNoNet - stats.total.costSimNoNet, -0.08 * 0.1 + 0.05 * 0.3), 'savings without net metering');
  assert(stats.total.since === '01-06-2026' && stats.days.length === 1, 'kept per day');
  // gaps longer than 6 minutes are not counted
  stats.add({ t: 2 * H, realGrid: 500, batteryPower: 0, price: 0.3, soc: 50 });
  assert(near(stats.total.hours, 0.2), 'gap skipped');

  await deviceDay();
  console.log('simulation tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * The full device on a simulated sunny day: the P1 meter sees the house (300 W) and solar panels
 * (peak 3 kW) without battery. The simulated battery must absorb the surplus and cover the evening.
 */
async function deviceDay() {
  let clock = Date.UTC(2026, 5, 1, 0, 0); // midnight
  const realNow = Date.now;
  Date.now = () => clock;

  class FakeDevice {
    constructor(settings) {
      this.settings = settings;
      this.caps = {};
      this.store = { day: 'x' };
      this.homey = {
        app: {
          prices: {
            futureSlots: () => [{ start: clock - H, end: clock + 48 * H, price: 0.2 }],
            onUpdate: () => () => {},
            setEntsoeToken() {},
            formatDate: (d) => new Date(d).toISOString().slice(0, 10),
          },
          batteries: () => [this],
          logbook: { add() {} },
          updateWebServer: () => {},
          triggers: new Proxy({}, { get: () => ({ trigger: async () => {} }) }),
        },
        clock: { getTimezone: () => 'UTC' },
        geolocation: { getLatitude: () => 52, getLongitude: () => 5 },
        setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
      };
      this.driver = { id: 'simulator' };
    }
    log() {}
    error() {}
    getSettings() { return this.settings; }
    getSetting(k) { return this.settings[k]; }
    async setSettings(s) { Object.assign(this.settings, s); }
    getStoreValue(k) { return this.store[k]; }
    async setStoreValue(k, v) { this.store[k] = v; }
    hasCapability(c) { return c !== 'measure_power'; }
    async addCapability() {}
    async removeCapability() {}
    getCapabilityValue(c) { return this.caps[c] ?? null; }
    async setCapabilityValue(c, v) {
      if (c === 'measure_power') throw new Error('simulator has no measure_power');
      this.caps[c] = v;
    }
    registerCapabilityListener() {}
    getAvailable() { return true; }
    async setAvailable() {}
    async setUnavailable() {}
    async setWarning() {}
    async unsetWarning() {}
    getName() { return 'sim'; }
    getData() { return { id: 'sim' }; }
  }

  const origLoad = Module._load;
  Module._load = function load(request, ...rest) {
    if (request === 'homey') return { Device: FakeDevice };
    return origLoad.call(this, request, ...rest);
  };
  const Device = require('../drivers/simulator/device');
  Module._load = origLoad;

  const d = new Device({
    p1_ip: '1.1.1.2', p1_token: '', interval: 5, capacity_kwh: 2.4, max_charge_w: 800, max_discharge_w: 800,
    min_soc: 10, max_soc: 100, efficiency: 85, auto_efficiency: false, grid_target: 0, gain: 0.7, deadband: 25,
    min_power: 30, force_charge_w: 800, force_discharge_w: 800, peak_threshold: 2500, markup: 0.02, tax_per_kwh: 0.11,
    min_spread: 0.05, dyn_low: 'charge', dyn_neutral: 'solar_only', dyn_high: 'self_consumption',
    grid_import_limit: 0, grid_export_limit: 0, switch_hysteresis: 0, charge_goal_soc: 100, discharge_goal_soc: 20,
    follow_up_strategy: 'self_consumption', avg_load_w: 500, day_load_w: 400, forecast_enabled: false, pv_kwp: 0,
    pv_tilt: 35, pv_azimuth: 0, pv2_kwp: 0, pv2_tilt: 35, pv2_azimuth: 90, entsoe_token: '', web_enabled: false, web_port: 8480, web_pin: '',
    sim_start_soc: 10, sim_rte: 88, sim_overhead_w: 8, sim_standby_w: 0.7, sim_idle_drain_w: 2.7, sim_delay_s: 3,
    sim_ramp_wps: 200, sim_export_fee: 0, sim_reset_stats: false,
  });
  d.caps.battery_strategy = 'self_consumption';
  await d.onInit();
  const house = () => {
    const hour = ((clock / H) % 24);
    const solar = hour > 6 && hour < 20 ? 3000 * Math.sin(((hour - 6) / 14) * Math.PI) : 0;
    return Math.round(300 - solar);
  };
  d.p1 = { read: async () => ({ gridPower: house() }) };

  let maxSoc = 0;
  // two days: the first starts with an empty battery, the second is a normal day
  for (let i = 1; i < (48 * 3600) / 5; i++) {
    clock += 5000;
    await d.tick();
    maxSoc = Math.max(maxSoc, d.caps.battery_soc);
  }
  const sim = d.simulationData();
  Date.now = realNow;

  const tot = sim.days[0]; // second day
  assert.strictEqual(sim.days.length, 2, 'two days recorded');
  console.log('sunny day:', JSON.stringify({
    realImport: tot.realImport, simImport: tot.simImport, realExport: tot.realExport, simExport: tot.simExport,
    charged: tot.charged, discharged: tot.discharged, savings: tot.savings, savingsNoNet: tot.savingsNoNet, soc: sim.socExact,
  }));
  assert(maxSoc >= 99, `battery filled by the sun (max ${maxSoc} %)`);
  assert(Math.abs(tot.charged - tot.solarCharged) < 0.05, 'charged (almost) only from solar surplus');
  assert(tot.simExport < tot.realExport - 2, 'export reduced by about the battery capacity');
  assert(tot.simImport < tot.realImport - 1.8, 'evening and night import covered by the battery');
  // flat price: with net metering storing solar only costs conversion losses; without, it pays off
  assert(tot.savings < 0 && tot.savingsNoNet > 0.1, 'savings only without net metering');
  assert(d.caps['measure_power.battery'] !== undefined, 'battery power on the sub-capability');
  // zero-grid works on the simulated grid: while charging below full power the simulated grid stays near 0
  assert(Math.abs(d.caps['measure_power.grid']) < 400, `grid with battery near zero at midnight (${d.caps['measure_power.grid']})`);

  // live chart: the last 5 minutes of control rounds (every 5 s)
  assert(sim.trace.length >= 55 && sim.trace.length <= 61, `5 minutes in the chart (${sim.trace.length})`);
  const [, p1, bat] = sim.trace[sim.trace.length - 1];
  assert.strictEqual(p1, house(), 'chart has the real P1 power');
  assert(Math.abs(bat + d.caps['measure_power.battery']) <= 1, 'chart has the battery power (+ discharge)');

  // simulated P1 meter: reads in between the control rounds, grid = P1 − simulated battery
  Date.now = () => clock;
  const SimP1 = loadWithHomey('../drivers/sim_p1/device', FakeDevice);
  const meter = new SimP1({ interval: 2 });
  meter.getData = () => ({ id: 'simp1-sim', simulator: 'sim' });
  meter.homey.drivers = { getDriver: () => ({ getDevices: () => [d] }) };
  clock += 2000;
  await meter.measure();
  Date.now = realNow;
  const c = meter.caps;
  assert.strictEqual(c['measure_power.p1'], house(), 'simulated P1: real P1 power');
  assert.strictEqual(c['measure_power.grid'], c['measure_power.p1'] - c['measure_power.battery'], 'simulated P1: grid = P1 − battery');
  assert.strictEqual(d.trace.samples[d.trace.samples.length - 1].t, clock, 'reading added to the chart');
  meter.homey.drivers = { getDriver: () => ({ getDevices: () => [] }) };
  await meter.measure();
  assert.strictEqual(meter.failures, 1, 'missing simulated battery counts as a failure');
}

function loadWithHomey(path, FakeDevice) {
  const origLoad = Module._load;
  Module._load = function load(request, ...rest) {
    if (request === 'homey') return { Device: FakeDevice };
    return origLoad.call(this, request, ...rest);
  };
  try {
    return require(path);
  } finally {
    Module._load = origLoad;
  }
}

// SimTrace: readings from two loops arrive out of order; old readings are dropped
{
  const tr = new SimTrace(60 * 1000);
  tr.add({ t: 10000, p1: 500, battery: 100 });
  tr.add({ t: 5000, p1: 400, battery: 0 });
  tr.add({ t: 20000, p1: 300, battery: 300 });
  assert.deepStrictEqual(tr.samples.map((s) => s.t), [5000, 10000, 20000], 'sorted by time');
  assert.strictEqual(tr.samples[1].grid, 400, 'grid = P1 − battery');
  tr.add({ t: 70000, p1: 0, battery: 0 });
  assert.deepStrictEqual(tr.samples.map((s) => s.t), [10000, 20000, 70000], 'older than a minute dropped');
  assert.strictEqual(tr.recent(30000, 70000).length, 1, 'recent');
}
