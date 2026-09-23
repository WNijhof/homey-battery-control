'use strict';

const fs = require('fs');
const path = require('path');
const Homey = require('homey');
const PriceService = require('./lib/prices');
const { WebServer } = require('./lib/webserver');
const { Logbook, maskSettings } = require('./lib/logbook');

const PRICE_REFRESH_MS = 30 * 60 * 1000;
const LOG_PERSIST_MS = 5 * 60 * 1000;
const BATTERY_DRIVERS = ['zendure', 'marstek', 'anker'];

class BatteryControlApp extends Homey.App {

  async onInit() {
    // first, so everything that follows can write to it
    this.logbook = new Logbook({
      timezone: this.homey.clock.getTimezone() || 'Europe/Amsterdam',
      load: () => this.homey.settings.get('logbook') || [],
      save: (lines) => this.homey.settings.set('logbook', lines),
    });
    this.logTimer = this.homey.setInterval(() => this.logbook.persist(), LOG_PERSIST_MS);
    this.log(`App gestart, versie ${this.homey.manifest.version}, Homey ${this.homey.version}`);

    this.prices = new PriceService({
      timezone: this.homey.clock.getTimezone() || 'Europe/Amsterdam',
      log: this.log.bind(this),
      error: this.error.bind(this),
    });
    // not awaited: without internet the batteries must still start (they update when prices arrive)
    this.prices.refresh().catch(this.error);
    this.priceTimer = this.homey.setInterval(() => {
      this.prices.refresh().catch(this.error);
    }, PRICE_REFRESH_MS);

    this.registerFlowCards();

    this.webServer = new WebServer({
      page: fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'),
      getDevices: () => this.batteries(),
      getSchema: (device) => this.settingsSchema(device.driver.id),
      getDiagnostics: () => this.diagnosticsText(),
      getRecentLog: (limit) => this.logbook.recent(limit),
      log: this.log.bind(this),
      error: this.error.bind(this),
    });
    // devices are initialised after the app; start the web page once they are there
    this.homey.setTimeout(() => this.updateWebServer(), 5000);
  }

  log(...args) {
    super.log(...args);
    if (this.logbook) this.logbook.add('info', 'app', ...args);
  }

  error(...args) {
    super.error(...args);
    if (this.logbook) this.logbook.add('error', 'app', ...args);
  }

  /** One text file for support: versions, batteries, settings (no secrets), plan and the log. */
  diagnosticsText() {
    const lines = [];
    const now = this.logbook.formatTime(Date.now());
    lines.push('=== Batterij Regeling – diagnose ===');
    lines.push(`Gemaakt: ${now}`);
    lines.push(`App: ${this.homey.manifest.id} v${this.homey.manifest.version} · Homey ${this.homey.version} · `
      + `tijdzone ${this.homey.clock.getTimezone()}`);
    const future = this.prices.futureSlots();
    lines.push(`Prijzen: ${future.length} kwartieren bekend`
      + `${future.length ? ` tot ${this.logbook.formatTime(future[future.length - 1].end)}` : ''}`);
    for (const device of this.batteries()) {
      lines.push('');
      lines.push(`--- ${device.getName()} (${device.driver.id}, id ${device.getData().id}) ---`);
      lines.push(`Beschikbaar: ${device.getAvailable()} · status: ${device.getCapabilityValue('battery_status')}`);
      const caps = {};
      for (const c of device.getCapabilities()) caps[c] = device.getCapabilityValue(c);
      lines.push(`Metingen: ${JSON.stringify(caps)}`);
      lines.push(`Instellingen: ${JSON.stringify(maskSettings(device.getSettings(), this.settingsSchema(device.driver.id)))}`);
      const plan = device.plan.slots.slice(0, 96).map((s) => `${this.logbook.formatTime(s.start).slice(-8, -3)} `
        + `${s.action[0]} ${s.price.toFixed(3)}`);
      lines.push(`Plan (tijd, c=laden d=ontladen h=vasthouden, prijs): ${plan.join(' | ')}`);
    }
    lines.push('');
    lines.push('=== Logboek (oudste eerst) ===');
    lines.push(this.logbook.toText());
    return lines.join('\n');
  }

  /** Flow cards are shared by all battery brands, so they are registered once here. */
  registerFlowCards() {
    const { flow } = this.homey;

    flow.getActionCard('set_strategy').registerRunListener(({ device, strategy }) => device.setStrategy(strategy));
    // never store more than the maximum power, otherwise later edits in the settings screen fail validation
    flow.getActionCard('force_charge').registerRunListener(async ({ device, power }) => {
      await device.setSettings({ force_charge_w: Math.min(power, device.getSetting('max_charge_w')) });
      await device.setStrategy('charge');
    });
    flow.getActionCard('force_discharge').registerRunListener(async ({ device, power }) => {
      await device.setSettings({ force_discharge_w: Math.min(power, device.getSetting('max_discharge_w')) });
      await device.setStrategy('discharge');
    });
    flow.getActionCard('set_grid_target').registerRunListener(
      ({ device, power }) => device.setSettings({ grid_target: power }),
    );
    flow.getActionCard('set_demo').registerRunListener(
      ({ device, enabled }) => device.setDemoMode(enabled === 'on'),
    );

    flow.getConditionCard('strategy_is').registerRunListener(
      ({ device, strategy }) => device.getCapabilityValue('battery_strategy') === strategy,
    );
    flow.getConditionCard('plan_is').registerRunListener(
      ({ device, action }) => device.getCapabilityValue('battery_plan') === action,
    );
    flow.getConditionCard('price_below').registerRunListener(({ device, price }) => {
      const current = device.getCapabilityValue('energy_price');
      return current !== null && current < price;
    });
    flow.getConditionCard('surplus_above').registerRunListener(({ device, power }) => device.surplus.current() > power);
    flow.getConditionCard('soc_above').registerRunListener(({ device, percent }) => {
      const soc = device.getCapabilityValue('measure_battery');
      return soc !== null && soc > percent;
    });
    flow.getConditionCard('demo_is_on').registerRunListener(({ device }) => device.getSetting('demo_mode') === true);

    this.triggers = {
      planChanged: flow.getDeviceTriggerCard('plan_changed'),
      strategyChanged: flow.getDeviceTriggerCard('strategy_changed'),
      demoChanged: flow.getDeviceTriggerCard('demo_changed'),
      surplusAbove: flow.getDeviceTriggerCard('surplus_above'),
      surplusBelow: flow.getDeviceTriggerCard('surplus_below'),
    };
    this.triggers.surplusAbove.registerRunListener((args, state) => args.device.surplusCrossed(args, state, true));
    this.triggers.surplusBelow.registerRunListener((args, state) => args.device.surplusCrossed(args, state, false));
  }

  /** All batteries of all brands. */
  batteries() {
    const devices = [];
    for (const id of BATTERY_DRIVERS) {
      try {
        devices.push(...this.homey.drivers.getDriver(id).getDevices());
      } catch (err) {
        // driver not ready yet
      }
    }
    return devices;
  }

  /** Start, move or stop the web page according to the settings of the (first) battery. */
  async updateWebServer() {
    const [device] = this.batteries();
    try {
      if (device && device.getSetting('web_enabled')) {
        await this.webServer.start(device.getSetting('web_port'));
      } else {
        await this.webServer.stop();
      }
    } catch (err) {
      this.error('Web page could not start:', err.message);
      if (device) {
        await device.setWarning(`Webpagina kon niet starten op poort ${device.getSetting('web_port')}: ${err.message}`)
          .catch(this.error);
      }
    }
  }

  /** Flat list of the settings of a battery driver (from the app manifest), Dutch labels, for the web page. */
  settingsSchema(driverId = 'zendure') {
    this.schemas = this.schemas || {};
    if (this.schemas[driverId]) return this.schemas[driverId];
    const driver = this.homey.manifest.drivers.find((d) => d.id === driverId);
    const text = (t) => (t && typeof t === 'object' ? t.nl || t.en : t) || '';
    const fields = [];
    for (const group of driver.settings) {
      for (const f of group.children || []) {
        fields.push({
          id: f.id,
          group: text(group.label),
          type: f.type,
          label: text(f.label),
          hint: text(f.hint),
          min: f.min,
          max: f.max,
          step: f.step,
          units: text(f.units),
          values: f.values ? f.values.map((v) => ({ id: v.id, label: text(v.label) })) : undefined,
        });
      }
    }
    this.schemas[driverId] = fields;
    return fields;
  }

  async onUninit() {
    if (this.logbook) this.logbook.persist();
    if (this.webServer) await this.webServer.stop();
  }

}

module.exports = BatteryControlApp;
