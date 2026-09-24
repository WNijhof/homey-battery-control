'use strict';

const BatteryDriver = require('../../lib/battery-driver');
const { SimulatedBattery } = require('../../lib/batteries/simulator');

class SimulatorDriver extends BatteryDriver {

  brand() {
    return {
      label: 'Simulatie SolarFlow 2400 AC+',
      modbus: false,
      simulated: true,
      hint: 'Een batterij die alleen in de app bestaat, met het gemeten gedrag van een Zendure SolarFlow 2400 AC+. '
        + 'Alleen de HomeWizard P1-meter is nodig.',
    };
  }

  identify() {
    return SimulatedBattery.identify();
  }

}

module.exports = SimulatorDriver;
