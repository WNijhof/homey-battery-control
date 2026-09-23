'use strict';

const BatteryDevice = require('../../lib/battery-device');
const { MarstekClient } = require('../../lib/batteries/marstek');

class MarstekDevice extends BatteryDevice {

  createBatteryClient() {
    return new MarstekClient({
      ip: this.getSetting('battery_ip'),
      port: this.getSetting('modbus_port'),
      unitId: this.getSetting('modbus_unit'),
      profile: this.getSetting('marstek_profile'),
      invert: this.getSetting('invert_power'),
    });
  }

}

module.exports = MarstekDevice;
