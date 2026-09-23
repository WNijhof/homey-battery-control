'use strict';

const Homey = require('homey');
const ZendureClient = require('../../lib/zendure');
const HomeWizardP1 = require('../../lib/homewizard');
const { scanNetwork } = require('../../lib/scanner');

const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

class ZendureDriver extends Homey.Driver {

  async onInit() {
    const card = (type, id) => this.homey.flow[type](id);

    card('getActionCard', 'set_strategy').registerRunListener(
      ({ device, strategy }) => device.setStrategy(strategy),
    );
    // never store more than the maximum power, otherwise later edits in the settings screen fail validation
    card('getActionCard', 'force_charge').registerRunListener(async ({ device, power }) => {
      await device.setSettings({ force_charge_w: Math.min(power, device.getSetting('max_charge_w')) });
      await device.setStrategy('charge');
    });
    card('getActionCard', 'force_discharge').registerRunListener(async ({ device, power }) => {
      await device.setSettings({ force_discharge_w: Math.min(power, device.getSetting('max_discharge_w')) });
      await device.setStrategy('discharge');
    });
    card('getActionCard', 'set_grid_target').registerRunListener(
      ({ device, power }) => device.setSettings({ grid_target: power }),
    );

    card('getConditionCard', 'strategy_is').registerRunListener(
      ({ device, strategy }) => device.getCapabilityValue('battery_strategy') === strategy,
    );
    card('getConditionCard', 'plan_is').registerRunListener(
      ({ device, action }) => device.getCapabilityValue('battery_plan') === action,
    );
    card('getConditionCard', 'price_below').registerRunListener(({ device, price }) => {
      const current = device.getCapabilityValue('energy_price');
      return current !== null && current < price;
    });

    card('getConditionCard', 'surplus_above').registerRunListener(
      ({ device, power }) => device.surplus.current() > power,
    );
    card('getConditionCard', 'soc_above').registerRunListener(({ device, percent }) => {
      const soc = device.getCapabilityValue('measure_battery');
      return soc !== null && soc > percent;
    });

    this.surplusAboveTrigger = card('getDeviceTriggerCard', 'surplus_above');
    this.surplusAboveTrigger.registerRunListener(
      (args, state) => args.device.surplusCrossed(args, state, true),
    );
    this.surplusBelowTrigger = card('getDeviceTriggerCard', 'surplus_below');
    this.surplusBelowTrigger.registerRunListener(
      (args, state) => args.device.surplusCrossed(args, state, false),
    );

    card('getConditionCard', 'demo_is_on').registerRunListener(
      ({ device }) => device.getSetting('demo_mode') === true,
    );
    card('getActionCard', 'set_demo').registerRunListener(
      ({ device, enabled }) => device.setDemoMode(enabled === 'on'),
    );
    this.demoChangedTrigger = card('getDeviceTriggerCard', 'demo_changed');

    this.planChangedTrigger = card('getDeviceTriggerCard', 'plan_changed');
    this.strategyChangedTrigger = card('getDeviceTriggerCard', 'strategy_changed');
  }

  async onPair(session) {
    session.setHandler('scan', async () => {
      const address = await this.homey.cloud.getLocalAddress();
      const ownIp = String(address).split(':')[0];
      this.log('Pair: scanning network around', ownIp);
      return scanNetwork(ownIp);
    });

    session.setHandler('configure', async ({ zendureIp, p1Ip, useV2 }) => {
      zendureIp = String(zendureIp || '').trim();
      p1Ip = String(p1Ip || '').trim();
      if (!IP_RE.test(zendureIp)) throw new Error('Ongeldig Zendure IP-adres');
      if (!IP_RE.test(p1Ip)) throw new Error('Ongeldig HomeWizard P1 IP-adres');

      let report;
      try {
        report = await new ZendureClient(zendureIp).report();
      } catch (err) {
        throw new Error(`Zendure niet bereikbaar op ${zendureIp}: ${err.message}`);
      }
      if (!report.sn) throw new Error('Zendure antwoordt, maar zonder serienummer. Is de firmware up-to-date?');

      if (!useV2) {
        try {
          await new HomeWizardP1(p1Ip).read();
        } catch (err) {
          throw new Error(`HomeWizard P1 niet bereikbaar op ${p1Ip}. Staat "Lokale API" aan? `
            + `Gebruik je API v2, vink dat dan aan. (${err.message})`);
        }
      }

      return {
        name: `Zendure ${report.product || 'SolarFlow'}`,
        data: { id: report.sn },
        store: { sn: report.sn },
        settings: { zendure_ip: zendureIp, p1_ip: p1Ip },
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

module.exports = ZendureDriver;
