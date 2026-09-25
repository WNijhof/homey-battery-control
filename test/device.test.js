'use strict';

// Offline test of the device with a simulated Homey: node test/device.test.js
// Checks that demo mode never writes to the battery, and that live mode does.
const assert = require('assert');
const Module = require('module');

class FakeDevice {
  constructor(settings) {
    this.settings = settings;
    this.caps = {};
    this.store = { day: 'x' };
    this.homey = {
      app: {
        prices: {
          futureSlots: () => [], onUpdate: () => () => {}, setEntsoeToken() {}, formatDate: () => 'x',
        },
        batteries: () => [this],
        logbook: { lines: [], add(level, source, ...parts) { this.lines.push([level, parts.join(' ')]); } },
        updateWebServer: () => {},
        triggers: {
          strategyChanged: { trigger: async () => {} },
          planChanged: { trigger: async () => {} },
          demoChanged: { trigger: async () => {} },
          surplusAbove: { trigger: async () => {} },
          surplusBelow: { trigger: async () => {} },
        },
      },
      clock: { getTimezone: () => 'Europe/Amsterdam' },
      geolocation: { getLatitude: () => 52, getLongitude: () => 5 },
      setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    };
    this.driver = { id: 'zendure' };
  }
  log() {}
  error() {}
  getSettings() { return this.settings; }
  getSetting(k) { return this.settings[k]; }
  async setSettings(s) { Object.assign(this.settings, s); }
  getStoreValue(k) { return this.store[k]; }
  async setStoreValue(k, v) { this.store[k] = v; }
  hasCapability() { return true; }
  async addCapability() {}
  getCapabilityValue(c) { return this.caps[c] ?? null; }
  async setCapabilityValue(c, v) { this.caps[c] = v; }
  registerCapabilityListener() {}
  getAvailable() { return true; }
  async setAvailable() {}
  async setUnavailable() {}
  async setWarning(w) { this.warning = w; }
  async unsetWarning() { this.warning = null; }
  getName() { return 'test'; }
}

const origLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'homey') return { Device: FakeDevice };
  return origLoad.call(this, request, ...rest);
};
const Device = require('../drivers/zendure/device');

// every brand driver loads (no syntax/require errors)
require('../drivers/marstek/device');
require('../drivers/anker/device');

const SETTINGS = {
  demo_mode: true, battery_ip: '1.1.1.1', p1_ip: '1.1.1.2', p1_token: '', interval: 5, capacity_kwh: 2.4,
  max_charge_w: 800, max_discharge_w: 800, min_soc: 10, max_soc: 100, efficiency: 85, auto_efficiency: true,
  grid_target: 20, gain: 0.7, deadband: 25, min_power: 30, force_charge_w: 800, force_discharge_w: 800,
  peak_threshold: 2500, markup: 0.02, tax_per_kwh: 0.11, min_spread: 0.05, dyn_low: 'charge',
  dyn_neutral: 'solar_only', dyn_high: 'self_consumption', grid_import_limit: 0, grid_export_limit: 0,
  switch_hysteresis: 0, charge_goal_soc: 100, discharge_goal_soc: 20, follow_up_strategy: 'self_consumption',
  avg_load_w: 500, day_load_w: 400, forecast_enabled: false, pv_kwp: 0, pv_tilt: 35, pv_azimuth: 0, pv2_kwp: 0, pv2_tilt: 35, pv2_azimuth: 90,
  entsoe_token: '',
};

async function makeDevice(demo, { p1Fails = false } = {}) {
  const d = new Device({ ...SETTINGS, demo_mode: demo });
  d.caps.battery_strategy = 'self_consumption';
  await d.onInit();
  d.writes = [];
  d.battery = {
    read: async () => ({ soc: 50, batteryPower: 0, sn: 'SN1' }),
    setPower: async (w) => d.writes.push(w),
    release: async () => d.writes.push('release'),
    close() {},
  };
  d.p1 = { read: async () => { if (p1Fails) throw new Error('offline'); return { gridPower: 600 }; } };
  return d;
}

(async () => {
  // demo: calculates a set-point but never writes
  let d = await makeDevice(true);
  await d.tick();
  assert.deepStrictEqual(d.writes, [], 'demo: no commands');
  assert(d.caps['measure_power.setpoint'] < 0, 'demo: desired discharge is shown (negative = discharging)');
  assert(/^Demo – zou: ontladen/.test(d.caps.battery_status), `demo status: ${d.caps.battery_status}`);

  // demo + P1 outage: still no commands
  d = await makeDevice(true, { p1Fails: true });
  for (let i = 0; i < 4; i++) await d.tick();
  assert.deepStrictEqual(d.writes, [], 'demo: no stand-by command on P1 outage');

  // demo: app stop does not touch the battery
  await d.onUninit();
  assert.deepStrictEqual(d.writes, [], 'demo: no command on app stop');

  // live: writes the set-point, and stand-by on stop
  d = await makeDevice(false);
  await d.tick();
  assert.strictEqual(d.writes.length, 1, 'live: command sent');
  assert(d.writes[0] > 0, 'live: discharges to cover 600 W import');
  await d.onUninit();
  assert.strictEqual(d.writes[d.writes.length - 1], 'release', 'live: battery handed back on stop');

  // live + P1 outage: stand-by after 3 failures
  d = await makeDevice(false, { p1Fails: true });
  for (let i = 0; i < 3; i++) await d.tick();
  assert.deepStrictEqual(d.writes, [0], 'live: stand-by after 3 failed P1 readings');
  assert(/P1 niet bereikbaar/.test(d.warning), 'live: warning shown');

  // switching demo off via Flow action resumes control
  d = await makeDevice(true);
  await d.setDemoMode(false);
  await d.tick();
  assert.strictEqual(d.writes.length, 1, 'after demo off: control resumes');

  // switching demo back on hands the battery back to its own program
  d = await makeDevice(false);
  await d.tick();
  await d.setDemoMode(true);
  assert.strictEqual(d.writes[d.writes.length - 1], 'release', 'demo on: battery released');

  // settings from the web page: type conversion, limits, validation, secrets
  d = await makeDevice(true);
  d.homey.app.settingsSchema = () => [
    { id: 'max_charge_w', type: 'number', label: 'Max laadvermogen', min: 100, max: 3200 },
    { id: 'min_soc', type: 'number', label: 'Min', min: 0, max: 50 },
    { id: 'max_soc', type: 'number', label: 'Max', min: 50, max: 100 },
    { id: 'demo_mode', type: 'checkbox', label: 'Demo' },
    { id: 'p1_token', type: 'password', label: 'Token' },
  ];
  d.homey.app.updateWebServer = () => {};
  assert.deepStrictEqual(await d.applySettings({ max_charge_w: '1000', p1_token: '' }), ['max_charge_w']);
  assert.strictEqual(d.settings.max_charge_w, 1000, 'number converted');
  assert.strictEqual(d.settings.p1_token, '', 'empty secret keeps current value');
  await assert.rejects(d.applySettings({ max_charge_w: 5000 }), /maximaal 3200/);
  await assert.rejects(d.applySettings({ max_soc: 50, min_soc: 50 }), /minimale laadniveau/);
  await assert.rejects(d.applySettings({ web_port: 80 }), /Onbekende instelling/);
  await d.applySettings({ demo_mode: 'false' });
  assert.strictEqual(d.settings.demo_mode, false, 'checkbox converted');

  // goal-driven: force charge until 50 % (battery reports 50 %) → follow-up strategy
  d = await makeDevice(false);
  d.settings.charge_goal_soc = 50;
  d.caps.battery_strategy = 'charge';
  await d.tick();
  assert.strictEqual(d.caps.battery_strategy, 'self_consumption', 'charge goal → follow-up strategy');

  // dropdown settings from the web page are checked against the allowed values
  d = await makeDevice(true);
  d.homey.app.settingsSchema = () => [
    { id: 'dyn_high', type: 'dropdown', label: 'Dure periodes', values: [{ id: 'self_consumption' }, { id: 'sell' }] },
  ];
  d.homey.app.updateWebServer = () => {};
  await d.applySettings({ dyn_high: 'sell' });
  assert.strictEqual(d.settings.dyn_high, 'sell');
  await assert.rejects(d.applySettings({ dyn_high: 'hack' }), /ongeldige keuze/);

  // one control round at a time: a second tick during a slow round does not send extra commands
  d = await makeDevice(false);
  let release;
  d.battery.read = () => new Promise((resolve) => {
    release = () => resolve({ soc: 50, batteryPower: 0, sn: 'SN1' });
  });
  const first = d.tick();
  await d.tick(); // arrives while the first round is still waiting for the battery
  release();
  await first;
  assert.strictEqual(d.writes.length, 1, 'overlapping round skipped');
  assert.strictEqual(d.tickRequested, false, 'skipped round is rescheduled');

  // after cleanup (app stop / device deleted) an in-flight round sends nothing
  d = await makeDevice(false);
  d.battery.read = () => new Promise((resolve) => {
    release = () => resolve({ soc: 50, batteryPower: 0, sn: 'SN1' });
  });
  const inFlight = d.tick();
  d.cleanup();
  release();
  await inFlight;
  assert.deepStrictEqual(d.writes, [], 'no command after cleanup');

  // logbook: one data line per minute, events as info
  d = await makeDevice(true);
  const lb = d.homey.app.logbook;
  lb.lines = [];
  await d.tick();
  await d.tick();
  const dataLines = lb.lines.filter(([level]) => level === 'data');
  assert.strictEqual(dataLines.length, 1, 'max one data line per minute');
  assert(/soc=50% batterij=0W net=600W gewenst=-?\d+W .*strategie=self_consumption .*DEMO/.test(dataLines[0][1]),
    dataLines[0][1]);
  await d.setStrategy('off');
  assert(lb.lines.some(([level, msg]) => level === 'info' && /Strategy -> off/.test(msg)), 'strategy change logged');

  console.log('device tests ok');
})().catch((err) => { console.error(err); process.exit(1); });
