'use strict';

const { requestJson } = require('./http');

const TOKEN_NAME = 'local/homey_batterij_regeling';

/**
 * HomeWizard P1 meter, local API.
 *  - v1: http://<ip>/api/v1/data              (enable "Local API" in the HomeWizard Energy app)
 *  - v2: https://<ip>/api/measurement + token (token via button press, see requestToken)
 * Power: positive = import from grid, negative = export.
 */
class HomeWizardP1 {

  constructor(ip, token) {
    this.ip = ip;
    this.token = token || null;
  }

  async read() {
    if (this.token) {
      const json = await requestJson(`https://${this.ip}/api/measurement`, {
        timeout: 3000,
        insecure: true,
        headers: { Authorization: `Bearer ${this.token}`, 'X-Api-Version': '2' },
      });
      if (typeof json.power_w !== 'number') throw new Error('P1 (v2) response has no power_w');
      return { gridPower: json.power_w };
    }
    const json = await requestJson(`http://${this.ip}/api/v1/data`, { timeout: 3000 });
    if (typeof json.active_power_w !== 'number') {
      throw new Error('P1 response has no active_power_w');
    }
    return { gridPower: json.active_power_w };
  }

  /**
   * Request an API v2 token. Returns the token, or null while the button on the
   * P1 meter has not been pressed yet (HTTP 403 user:creation-not-enabled).
   */
  static async requestToken(ip) {
    try {
      const json = await requestJson(`https://${ip}/api/user`, {
        method: 'POST',
        timeout: 3000,
        insecure: true,
        headers: { 'X-Api-Version': '2' },
        body: { name: TOKEN_NAME },
      });
      return json.token || null;
    } catch (err) {
      if (err.statusCode === 403) return null;
      throw err;
    }
  }

  /** Identify a HomeWizard device on an IP (used by the network scan). */
  static async identify(ip, timeout = 1500) {
    const json = await requestJson(`http://${ip}/api`, { timeout });
    if (!json.product_type) throw new Error('not a HomeWizard device');
    return { ip, product: json.product_name || json.product_type, type: json.product_type };
  }

}

module.exports = HomeWizardP1;
