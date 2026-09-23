'use strict';

const BatteryDriver = require('../../lib/battery-driver');
const { AnkerClient } = require('../../lib/batteries/anker');

class AnkerDriver extends BatteryDriver {

  brand() {
    return {
      label: 'Anker SOLIX',
      modbus: true,
      hint: 'Solarbank Max AC, Solarbank Max, XE (AC) of Solarbank 4 E5000 Pro. Zet eerst in de Anker-app '
        + 'bij het apparaat "Three-Party Control Settings → Modbus TCP" aan.',
    };
  }

  identify(ip, options) {
    return AnkerClient.identify(ip, options);
  }

}

module.exports = AnkerDriver;
