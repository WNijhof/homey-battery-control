'use strict';

const BatteryDevice = require('../../lib/battery-device');
const { SimulatedBattery } = require('../../lib/batteries/simulator');
const { SimulationStats } = require('../../lib/simstats');

const STATS_SAVE_MS = 5 * 60 * 1000;

/**
 * Simulated Zendure SolarFlow 2400 AC+ on the real P1 meter: the whole control runs as with a real
 * battery, the battery itself only exists in memory. Keeps a comparison with and without battery.
 */
class SimulatorDevice extends BatteryDevice {

  async onInit() {
    this.simStats = new SimulationStats({
      saved: this.getStoreValue('sim_stats'),
      formatDate: (d) => this.homey.app.prices.formatDate(d),
    });
    this.statsTimer = this.homey.setInterval(() => this.saveStats(), STATS_SAVE_MS);
    await super.onInit();
  }

  createBatteryClient() {
    const s = this.getSettings();
    let state = this.battery && this.battery.simulated ? this.battery.state() : this.getStoreValue('sim_state');
    // a new start level (or the first start) resets the battery
    if (!state || this.getStoreValue('sim_start') !== s.sim_start_soc) {
      state = { soc: s.sim_start_soc, time: null };
      this.setStoreValue('sim_start', s.sim_start_soc).catch(this.error);
    }
    return new SimulatedBattery({
      capacityKwh: s.capacity_kwh,
      maxChargeW: s.max_charge_w,
      maxDischargeW: s.max_discharge_w,
      minSoc: s.min_soc,
      maxSoc: s.max_soc,
      rte: s.sim_rte / 100,
      overheadW: s.sim_overhead_w,
      standbyW: s.sim_standby_w,
      idleDrainW: s.sim_idle_drain_w,
      delayS: s.sim_delay_s,
      rampWps: s.sim_ramp_wps,
      soc: state.soc,
      since: state.time,
      onState: (st) => this.setStoreValue('sim_state', st).catch(this.error),
    });
  }

  onSimulatedReading(bat, realGrid) {
    this.lastRealGrid = realGrid;
    const price = this.currentPrice ?? null;
    const markup = this.getSetting('markup') + this.getSetting('tax_per_kwh');
    this.simStats.add({
      t: Date.now(),
      realGrid,
      batteryPower: bat.batteryPower,
      price,
      // without net metering the export earns the market price (incl. VAT) minus the supplier's fee
      exportPrice: price === null ? null : price - markup - this.getSetting('sim_export_fee'),
      soc: bat.soc,
    });
  }

  simulationData() {
    const capacity = this.getSetting('capacity_kwh');
    const days = this.simStats.days.slice(-14).reverse().map((d) => SimulationStats.summary(d, capacity));
    return {
      model: this.battery ? this.battery.opts : null,
      realGrid: this.lastRealGrid ?? null,
      socExact: this.battery ? Math.round(this.battery.soc() * 10) / 10 : null,
      total: SimulationStats.summary(this.simStats.total, capacity),
      days,
    };
  }

  saveStats() {
    this.setStoreValue('sim_stats', this.simStats.toJSON()).catch(this.error);
  }

  afterSettingsChanged(changedKeys, newSettings) {
    if (changedKeys.includes('sim_reset_stats') && newSettings.sim_reset_stats) {
      this.simStats.reset();
      this.saveStats();
      this.log('Simulatie: statistieken gewist');
      this.setSettings({ sim_reset_stats: false }).catch(this.error);
    }
    super.afterSettingsChanged(changedKeys, newSettings);
  }

  async onUninit() {
    this.saveStats();
    if (this.statsTimer) this.homey.clearInterval(this.statsTimer);
    await super.onUninit();
  }

  async onDeleted() {
    if (this.statsTimer) this.homey.clearInterval(this.statsTimer);
    await super.onDeleted();
  }

}

module.exports = SimulatorDevice;
