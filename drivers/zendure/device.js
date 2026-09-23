'use strict';

const BatteryDevice = require('../../lib/battery-device');
const ZendureClient = require('../../lib/batteries/zendure');

class ZendureDevice extends BatteryDevice {

  createBatteryClient() {
    return new ZendureClient(this.getSetting('battery_ip'), this.getStoreValue('sn'));
  }

}

module.exports = ZendureDevice;
