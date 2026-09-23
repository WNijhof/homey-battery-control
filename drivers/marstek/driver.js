'use strict';

const BatteryDriver = require('../../lib/battery-driver');
const { MarstekClient, PROFILES } = require('../../lib/batteries/marstek');

class MarstekDriver extends BatteryDriver {

  brand() {
    return {
      label: 'Marstek Venus',
      modbus: true,
      profiles: Object.entries(PROFILES).map(([id, p]) => ({ id, label: p.label })),
      hint: 'Venus E v3: IP-adres van de batterij zelf (netwerkkabel). Venus E v1/v2, A en D: IP-adres van '
        + 'de RS485-naar-Modbus-TCP-adapter (bijv. Elfin EW11).',
    };
  }

  identify(ip, options) {
    return MarstekClient.identify(ip, options);
  }

}

module.exports = MarstekDriver;
