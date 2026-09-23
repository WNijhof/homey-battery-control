'use strict';

const { requestJson } = require('./http');

/**
 * Zendure SolarFlow local API (zenSDK), e.g. SolarFlow 2400 AC / AC+.
 *   GET  http://<ip>/properties/report
 *   POST http://<ip>/properties/write  {"sn": "...", "properties": {...}}
 *
 * acMode: 1 = input (charge from AC), 2 = output (discharge to AC)
 * smartMode: 1 = write limits to RAM only (no flash wear)
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

}

module.exports = ZendureClient;
