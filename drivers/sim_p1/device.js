'use strict';

const Homey = require('homey');

const FAILURES_BEFORE_UNAVAILABLE = 5;

/**
 * Simulated P1 meter: what the HomeWizard P1 would show if the simulated battery really charged and
 * discharged (grid = real P1 − simulated battery power). Reads on its own, short interval, in between
 * the control rounds, so the reaction of the control is visible second by second.
 * Only sub-capabilities (measure_power.*): Homey Energy must not count this device.
 */
class SimulatedP1Device extends Homey.Device {

  async onInit() {
    this.failures = 0;
    this.schedule(1000);
  }

  error(...args) {
    super.error(...args);
    const { logbook } = this.homey.app;
    if (logbook) logbook.add('error', this.getName(), ...args);
  }

  simulator() {
    const id = this.getData().simulator;
    return this.homey.drivers.getDriver('simulator').getDevices().find((d) => d.getData().id === id) || null;
  }

  schedule(delay) {
    if (this.stopped) return;
    this.timer = this.homey.setTimeout(() => this.measure(), delay);
  }

  async measure() {
    try {
      const sim = this.simulator();
      if (!sim) throw new Error('Gesimuleerde batterij niet gevonden (verwijderd?)');
      const { p1, battery, grid } = await sim.readSimulatedGrid();
      await Promise.all([
        this.setCapabilityValue('measure_power.grid', grid),
        this.setCapabilityValue('measure_power.p1', p1),
        this.setCapabilityValue('measure_power.battery', battery),
      ]);
      this.failures = 0;
      if (!this.getAvailable()) await this.setAvailable();
    } catch (err) {
      this.failures += 1;
      if (this.failures === 1) this.error('Simulated P1 reading failed:', err.message);
      if (this.failures >= FAILURES_BEFORE_UNAVAILABLE) await this.setUnavailable(err.message).catch(this.error);
    } finally {
      const interval = this.getSetting('interval') * 1000;
      this.schedule(this.failures ? Math.min(30000, interval * (1 + this.failures)) : interval);
    }
  }

  async onUninit() {
    this.stopped = true;
    if (this.timer) this.homey.clearTimeout(this.timer);
  }

  async onDeleted() {
    await this.onUninit();
  }

}

module.exports = SimulatedP1Device;
