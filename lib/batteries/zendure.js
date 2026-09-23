'use strict';

const { requestJson } = require('../http');

/**
 * Zendure SolarFlow local API (zenSDK): SolarFlow 800 / 800 Plus / 800 Pro, 1600 AC+,
 * 2400 AC / AC+ / Pro.
 *   GET  http://<ip>/properties/report
 *   POST http://<ip>/properties/write  {"sn": "...", "properties": {...}}
 *
 * acMode: 1 = input (charge from AC), 2 = output (discharge to AC)
 * smartMode: 1 = write limits to RAM only (no flash wear)
 *
 * Common battery interface (also used by Marstek and Anker):
 *   read()          → { soc, batteryPower (+ discharge / − charge, AC side), solar, sn, product }
 *   setPower(watts) → + discharge, − charge, 0 idle
 *   release()       → hand control back to the battery's own program (as far as possible)
 *   close()
 */
class ZendureClient {

  constructor(ip, sn) {
    this.ip = ip;
    this.sn = sn;
    this.msgId = 0;
  }

  async report({ timeout = 5000 } = {}) {
    const json = await requestJson(`http://${this.ip}/properties/report`, { timeout });
    if (json.sn && !this.sn) this.sn = json.sn;
    return json;
  }

  async read() {
    return ZendureClient.parse(await this.report());
  }

  async write(properties) {
    this.msgId += 1;
    return requestJson(`http://${this.ip}/properties/write`, {
      method: 'POST',
      body: { id: this.msgId, sn: this.sn, properties },
    });
  }

  /**
   * Set battery AC power. Positive = discharge to home, negative = charge from grid, 0 = idle.
   */
  async setPower(watts) {
    const w = Math.round(watts);
    if (w > 0) {
      return this.write({
        smartMode: 1, acMode: 2, outputLimit: w, inputLimit: 0,
      });
    }
    if (w < 0) {
      return this.write({
        smartMode: 1, acMode: 1, outputLimit: 0, inputLimit: -w,
      });
    }
    return this.write({
      smartMode: 1, acMode: 2, outputLimit: 0, inputLimit: 0,
    });
  }

  /**
   * The zenSDK has no "return to app mode" command: the limits were written to RAM (smartMode 1),
   * so the battery stays idle until its own program (Zendure app) or a restart takes over.
   */
  async release() {
    return this.setPower(0);
  }

  close() {}

  /**
   * Parse a report into normalised values.
   * batteryPower: positive = discharging to home, negative = charging from grid (AC side).
   */
  static parse(report) {
    const p = report.properties || {};
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const acOut = num(p.outputHomePower);
    const acIn = num(p.gridInputPower);
    return {
      soc: typeof p.electricLevel === 'number' ? p.electricLevel : null,
      batteryPower: acOut - acIn,
      solar: num(p.solarInputPower),
      acMode: p.acMode,
      minSoc: p.minSoc,
      socSet: p.socSet,
      product: report.product,
      sn: report.sn,
    };
  }

  /** Pairing: connect and return identity (throws when not a zenSDK device). */
  static async identify(ip) {
    const report = await new ZendureClient(ip).report();
    if (!report.sn) throw new Error('Zendure antwoordt, maar zonder serienummer. Is de firmware up-to-date?');
    return { id: report.sn, name: `Zendure ${report.product || 'SolarFlow'}`, store: { sn: report.sn } };
  }

}

module.exports = ZendureClient;
