'use strict';

const BatteryDevice = require('../../lib/battery-device');
const { AnkerClient } = require('../../lib/batteries/anker');

class AnkerDevice extends BatteryDevice {

  createBatteryClient() {
    return new AnkerClient({
      ip: this.getSetting('battery_ip'),
      port: this.getSetting('modbus_port'),
      unitId: this.getSetting('modbus_unit'),
      invert: this.getSetting('invert_power'),
    });
  }

}

module.exports = AnkerDevice;
