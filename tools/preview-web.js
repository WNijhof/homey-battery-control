'use strict';

// Preview of the web page with live prices and sample values: node tools/preview-web.js  → http://localhost:8480
const fs = require('fs');
const path = require('path');
const { WebServer } = require('../lib/webserver');
const PriceService = require('../lib/prices');
const { makePlan } = require('../lib/planner');
const manifest = require('../app.json');

(async () => {
  const prices = new PriceService();
  await prices.refresh();
  const plan = makePlan(prices.futureSlots(), {
    capacityKwh: 2.4, minSoc: 10, maxSoc: 100, maxChargeW: 800, maxDischargeW: 800, efficiency: 0.85,
    minSpread: 0.05, markup: 0.13, avgLoadW: 500, soc: 62,
  });
  const driver = manifest.drivers.find((d) => d.id === 'zendure');
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
      demo: true, available: true, warning: null, threshold: plan.dischargeThreshold,
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
