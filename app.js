'use strict';

const fs = require('fs');
const path = require('path');
const Homey = require('homey');
const PriceService = require('./lib/prices');
const { WebServer } = require('./lib/webserver');

const PRICE_REFRESH_MS = 30 * 60 * 1000;

class BatteryControlApp extends Homey.App {

  async onInit() {
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

    this.webServer = new WebServer({
      page: fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'),
      getDevices: () => this.batteries(),
      getSchema: () => this.settingsSchema(),
      log: this.log.bind(this),
      error: this.error.bind(this),
    });
    // devices are initialised after the app; start the web page once they are there
    this.homey.setTimeout(() => this.updateWebServer(), 5000);

    this.log('Battery Control started');
  }

  batteries() {
    try {
      return this.homey.drivers.getDriver('zendure').getDevices();
    } catch (err) {
      return [];
    }
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

  /** Flat list of the battery settings (from the app manifest), Dutch labels, for the web page. */
  settingsSchema() {
    if (this.schema) return this.schema;
    const driver = this.homey.manifest.drivers.find((d) => d.id === 'zendure');
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
    this.schema = fields;
    return fields;
  }

  async onUninit() {
    if (this.webServer) await this.webServer.stop();
  }

}

module.exports = BatteryControlApp;
