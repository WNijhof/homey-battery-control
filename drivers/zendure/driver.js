'use strict';

const BatteryDriver = require('../../lib/battery-driver');
const ZendureClient = require('../../lib/batteries/zendure');

class ZendureDriver extends BatteryDriver {

  brand() {
    return {
      label: 'Zendure SolarFlow',
      modbus: false,
      hint: 'SolarFlow 800 / 800 Plus / 800 Pro / 1600 AC+ / 2400 AC / AC+ / Pro met recente firmware (lokale zenSDK-API).',
    };
  }

  identify(ip) {
    return ZendureClient.identify(ip);
  }

}

module.exports = ZendureDriver;
