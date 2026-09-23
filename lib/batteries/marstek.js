'use strict';

const {
  ModbusTcp, int16, int32, regsToString,
} = require('../modbus');

/**
 * Marstek Venus via Modbus TCP.
 *  - Venus E v3: built-in Ethernet port with Modbus TCP
 *  - Venus E v1/v2, Venus A, Venus D: via an RS485-to-Modbus-TCP bridge (e.g. Elfin EW11, LilyGo)
 *
 * Control (same for all models):
 *   42000 = 21930  RS485 control on   (21947 = off → battery returns to its own work mode)
 *   42010          force mode: 0 standby, 1 charge, 2 discharge
 *   42020 / 42021  charge / discharge power (W)
 *
 * Register maps per model from the community integrations (ViperRNMC/marstek_venus_modbus);
 * the v3/A/D maps are marked there as partially validated — check the values in demo mode first.
 */
const PROFILES = {
  e_v12: {
    label: 'Venus E v1/v2',
    soc: { address: 32104, scale: 1 },
    acPower: { address: 32202, words: 2 },
    name: null,
  },
  e_v3: {
    label: 'Venus E v3',
    soc: { address: 34002, scale: 0.1 },
    acPower: { address: 30006, words: 1 },
    name: { address: 31000, words: 10 },
  },
  a: {
    label: 'Venus A',
    soc: { address: 32104, scale: 1 },
    acPower: { address: 30006, words: 1 },
    name: null,
  },
  d: {
    label: 'Venus D',
    soc: { address: 32104, scale: 1 },
    acPower: { address: 30006, words: 1 },
    name: null,
  },
};

const RS485_ON = 21930;
const RS485_OFF = 21947;
const REG_RS485 = 42000;
const REG_FORCE = 42010;
const REG_CHARGE = 42020;
const REG_DISCHARGE = 42021;

class MarstekClient {

  /**
   * @param {object} o
   * @param {string} o.ip
   * @param {number} [o.port]
   * @param {number} [o.unitId]
   * @param {string} [o.profile]       e_v12 | e_v3 | a | d
   * @param {boolean} [o.invert]       AC power sign inverted (check in demo mode)
   */
  constructor({
    ip, port = 502, unitId = 1, profile = 'e_v3', invert = false,
  }) {
    this.profile = PROFILES[profile] || PROFILES.e_v3;
    this.invert = invert;
    this.modbus = new ModbusTcp({ host: ip, port, unitId });
    this.written = {}; // register cache: only write what changes
    this.rs485 = false;
  }

  async read() {
    const { soc, acPower } = this.profile;
    const socRaw = (await this.modbus.readHolding(soc.address, 1))[0];
    const powerRegs = await this.modbus.readHolding(acPower.address, acPower.words);
    const power = acPower.words === 2 ? int32(powerRegs) : int16(powerRegs[0]);
    return {
      soc: Math.round(socRaw * soc.scale * 10) / 10,
      // Marstek AC power: positive = discharging to the house (invert when the demo shows otherwise)
      batteryPower: this.invert ? -power : power,
      solar: 0,
      sn: null,
      product: this.profile.label,
    };
  }

  async writeIfChanged(address, value) {
    if (this.written[address] === value) return;
    await this.modbus.writeSingle(address, value);
    this.written[address] = value;
  }

  async setPower(watts) {
    const w = Math.round(watts);
    if (!this.rs485) {
      await this.modbus.writeSingle(REG_RS485, RS485_ON);
      this.rs485 = true;
      this.written = {};
    }
    if (w > 0) {
      await this.writeIfChanged(REG_DISCHARGE, w);
      await this.writeIfChanged(REG_FORCE, 2);
    } else if (w < 0) {
      await this.writeIfChanged(REG_CHARGE, -w);
      await this.writeIfChanged(REG_FORCE, 1);
    } else {
      await this.writeIfChanged(REG_FORCE, 0);
    }
  }

  /** Switch RS485 control off: the battery returns to its own work mode (Marstek app). */
  async release() {
    try {
      await this.modbus.writeSingle(REG_FORCE, 0);
      await this.modbus.writeSingle(REG_RS485, RS485_OFF);
    } finally {
      this.rs485 = false;
      this.written = {};
    }
  }

  close() {
    this.modbus.close();
  }

  static async identify(ip, { port = 502, unitId = 1, profile = 'e_v3' } = {}) {
    const client = new MarstekClient({
      ip, port, unitId, profile,
    });
    try {
      const data = await client.read();
      if (data.soc === null || data.soc < 0 || data.soc > 100) {
        throw new Error(`Onverwacht laadniveau (${data.soc}) — klopt het gekozen model?`);
      }
      let name = `Marstek ${client.profile.label}`;
      if (client.profile.name) {
        const raw = regsToString(await client.modbus.readHolding(client.profile.name.address, client.profile.name.words));
        if (raw) name = `Marstek ${raw}`;
      }
      return {
        id: `marstek-${ip}-${unitId}`, name, store: { soc: data.soc },
      };
    } finally {
      client.close();
    }
  }

}

module.exports = { MarstekClient, PROFILES };
