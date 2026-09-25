'use strict';

const Homey = require('homey');

/** Simulated P1 meter: one per simulated battery. */
class SimulatedP1Driver extends Homey.Driver {

  async onPairListDevices() {
    const simulators = this.homey.drivers.getDriver('simulator').getDevices();
    if (!simulators.length) throw new Error('Voeg eerst een gesimuleerde batterij toe.');
    const taken = new Set(this.getDevices().map((d) => d.getData().simulator));
    return simulators
      .filter((sim) => !taken.has(sim.getData().id))
      .map((sim) => ({
        name: `P1 met ${sim.getName()}`,
        data: { id: `simp1-${sim.getData().id}`, simulator: sim.getData().id },
      }));
  }

}

module.exports = SimulatedP1Driver;
