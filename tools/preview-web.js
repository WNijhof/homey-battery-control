'use strict';

// Preview of the web page with live prices and sample values: node tools/preview-web.js  → http://localhost:8480
// With --sim: the simulated battery (sample comparison with and without battery).
const fs = require('fs');
const path = require('path');
const { WebServer } = require('../lib/webserver');
const PriceService = require('../lib/prices');
const { makePlan } = require('../lib/planner');
const manifest = require('../app.json');
const { SimulationStats } = require('../lib/simstats');

const SIM = process.argv.includes('--sim');

function sampleSimulation() {
  const day = (date, f) => SimulationStats.summary({
    date, hours: 24, pricedHours: 24, realImport: 6.1 * f, realExport: 14.2 * f, simImport: 4.3 * f, simExport: 12.1 * f,
    charged: 2.3 * f, discharged: 1.95 * f, solarCharged: 2.2 * f, gridCharged: 0.1 * f, dischargeHome: 1.95 * f,
    dischargeExport: 0, costReal: 0.21 * f, costSim: 0.16 * f, costRealNoNet: 1.35 * f, costSimNoNet: 0.98 * f,
  }, 2.4);
  const days = [day('24-09-2026', 0.5), day('23-09-2026', 1), day('22-09-2026', 0.9)];
  const total = { ...day('22-09-2026', 2.4), since: '22-09-2026' };
  return {
    model: {
      capacityKwh: 2.4, maxChargeW: 800, maxDischargeW: 800, rte: 0.88, overheadW: 8, standbyW: 0.7, idleDrainW: 2.7, delayS: 3,
    },
    realGrid: -1240,
    socExact: 62.4,
    total,
    days,
  };
}

(async () => {
  const prices = new PriceService();
  await prices.refresh();
  const plan = makePlan(prices.futureSlots(), {
    capacityKwh: 2.4, minSoc: 10, maxSoc: 100, maxChargeW: 800, maxDischargeW: 800, efficiency: 0.85,
    minSpread: 0.05, markup: 0.13, avgLoadW: 500, soc: 62,
  });
  const driver = manifest.drivers.find((d) => d.id === (SIM ? 'simulator' : 'zendure'));
  const settings = {};
  const schema = [];
  for (const g of driver.settings) {
    for (const f of g.children) {
      settings[f.id] = f.value;
      schema.push({
        id: f.id, group: g.label.nl, type: f.type, label: f.label.nl, hint: f.hint?.nl || '',
        min: f.min, max: f.max, step: f.step, units: f.units?.en || '',
        values: f.values?.map((v) => ({ id: v.id, label: v.label.nl })),
      });
    }
  }
  Object.assign(settings, { zendure_ip: '192.168.1.50', p1_ip: '192.168.1.60', web_pin: '1234' });
  const device = {
    getData: () => ({ id: 'HOA1234' }),
    getSettings: () => settings,
    getSetting: (k) => settings[k],
    async applySettings(c) { Object.assign(settings, c); return Object.keys(c); },
    async setStrategy() {},
    getWebData: () => ({
      id: 'HOA1234', name: 'Zendure solarFlow2400AC+', soc: 62, power: -340, strategy: 'dynamic',
      status: 'Demo – zou: ontladen 340 W · dynamic:discharge', price: plan.slots[0]?.price, savingsToday: 0.41,
      demo: !SIM, available: true, warning: null, threshold: plan.dischargeThreshold,
      simulation: SIM ? sampleSimulation() : null,
      slots: plan.slots.slice(0, 96),
      values: {
        grid: 12, setpoint: -340, surplus: 0, plan: plan.slots[0]?.action, charged: 12.4, discharged: 10.6,
        savingsTotal: 4.87, efficiency: 86.2, forecastToday: 9.3,
      },
    }),
  };
  const server = new WebServer({
    page: fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8'),
    getDevices: () => [device],
    getSchema: () => schema,
    getDiagnostics: () => 'voorbeeld',
    getRecentLog: () => [
      { time: '23-09-2026 16:00:02', level: 'info', source: 'app', message: 'App gestart, versie 0.5.0' },
      { time: '23-09-2026 16:00:05', level: 'info', source: 'Zendure', message: 'Plan: charge @ €0.197' },
      { time: '23-09-2026 16:01:05', level: 'data', source: 'Zendure', message: 'soc=62% batterij=-340W net=12W gewenst=-352W overschot=0W strategie=dynamic plan=charge prijs=0.327 DEMO' },
      { time: '23-09-2026 16:03:40', level: 'error', source: 'Zendure', message: 'P1 read failed (1x): Timeout', repeat: 3 },
      { time: '23-09-2026 16:03:55', level: 'info', source: 'Zendure', message: 'P1-meter niet bereikbaar: regeling op stand-by' },
    ],
    log: console.log,
  });
  await server.start(8480);
})();
