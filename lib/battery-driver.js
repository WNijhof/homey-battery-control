'use strict';

const Homey = require('homey');
const HomeWizardP1 = require('./homewizard');
const { scanNetwork } = require('./scanner');

const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Shared driver: pairing (network scan, connection test) and repair (HomeWizard API v2 token).
 * Brand drivers describe themselves with brand() and identify().
 */
class BatteryDriver extends Homey.Driver {

  /**
   * @abstract
   * @returns {{ label: string, modbus: boolean, profiles?: {id: string, label: string}[], hint?: string }}
   */
  brand() {
    throw new Error('brand() not implemented');
  }

  /** @abstract connect to the battery and return { id, name, store } */
  async identify() {
    throw new Error('identify() not implemented');
  }

  async onPair(session) {
    session.setHandler('info', async () => this.brand());

    session.setHandler('scan', async () => {
      const address = await this.homey.cloud.getLocalAddress();
      const ownIp = String(address).split(':')[0];
      this.log('Pair: scanning network around', ownIp);
      const { modbus, simulated } = this.brand();
      const result = await scanNetwork(ownIp, { zendure: !modbus && !simulated, modbusPort: modbus ? 502 : null });
      return {
        batteries: modbus ? result.modbus : result.zendure,
        homewizard: result.homewizard,
      };
    });

    session.setHandler('configure', async ({
      batteryIp, p1Ip, useV2, port, unitId, profile,
    }) => {
      batteryIp = String(batteryIp || '').trim();
      p1Ip = String(p1Ip || '').trim();
      const { modbus, label, simulated } = this.brand();
      if (!simulated && !IP_RE.test(batteryIp)) throw new Error('Ongeldig IP-adres van de batterij');
      if (!IP_RE.test(p1Ip)) throw new Error('Ongeldig HomeWizard P1 IP-adres');
      const options = modbus ? { port: Number(port) || 502, unitId: Number(unitId) || 1, profile } : {};

      let identity;
      try {
        identity = await this.identify(batteryIp, options);
      } catch (err) {
        throw new Error(`${label} niet bereikbaar op ${batteryIp}: ${err.message}`);
      }

      if (!useV2) {
        try {
          await new HomeWizardP1(p1Ip).read();
        } catch (err) {
          throw new Error(`HomeWizard P1 niet bereikbaar op ${p1Ip}. Staat "Lokale API" aan? `
            + `Gebruik je API v2, vink dat dan aan. (${err.message})`);
        }
      }

      const settings = simulated ? { p1_ip: p1Ip } : { battery_ip: batteryIp, p1_ip: p1Ip };
      if (modbus) {
        settings.modbus_port = options.port;
        settings.modbus_unit = options.unitId;
        if (profile) settings.marstek_profile = profile;
      }
      return {
        name: identity.name,
        data: { id: identity.id },
        store: identity.store || {},
        settings,
      };
    });
  }

  /** Repair: obtain a HomeWizard API v2 token (user presses the button on the P1 meter). */
  async onRepair(session, device) {
    session.setHandler('hw_token', async () => {
      const ip = device.getSetting('p1_ip');
      const deadline = Date.now() + 60 * 1000;
      while (Date.now() < deadline) {
        const token = await HomeWizardP1.requestToken(ip);
        if (token) {
          await new HomeWizardP1(ip, token).read(); // verify before saving
          await device.setSettings({ p1_token: token });
          device.createClients();
          return true;
        }
        await new Promise((resolve) => { this.homey.setTimeout(resolve, 2000); });
      }
      throw new Error('Geen knopdruk ontvangen binnen 60 seconden. Probeer het opnieuw.');
    });
  }

}

module.exports = BatteryDriver;
