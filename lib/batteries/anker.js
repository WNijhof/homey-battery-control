'use strict';

const {
  ModbusTcp, int32, toInt32Words, regsToString,
} = require('../modbus');

/**
 * Anker SOLIX via the official local Modbus TCP interface (Anker app → device → Three-Party
 * Control Settings → Modbus TCP). Solarbank Max AC, Solarbank Max, XE / XE AC, Solarbank 4 E5000 Pro.
 * Register map from Anker's official Home Assistant integration (anker-charging/ha-anker-solix-official).
 *
 *   input   10008 INT32   battery power (+ discharge / − charge)
 *   input   10012 INT32   grid power
 *   input   10014 UINT16  state of charge (%)
 *   input   10100 STRING  serial number (12 registers)
 *   input   32768 STRING  model (5 registers)
 *   holding 10064 UINT16  operating mode: 0 self-consumption, 1 TOU, 3 third-party control, 4 custom,
 *                         5 socket overlay, 6 smart, 7 dynamic pricing
 *   holding 10071 INT32   battery power set-point in third-party mode (− charge / + discharge)
 */
const REG_BATTERY_POWER = 10008;
const REG_SOC = 10014;
const REG_SN = 10100;
const REG_MODEL = 32768;
const REG_MODE = 10064;
const REG_SETPOINT = 10071;
const MODE_THIRD_PARTY = 3;

class AnkerClient {

  constructor({
    ip, port = 502, unitId = 1, invert = false,
  }) {
    this.invert = invert;
    this.modbus = new ModbusTcp({ host: ip, port, unitId });
    this.originalMode = null; // restored on release()
    this.modeSet = false;
    this.lastSetpoint = null;
  }

  async read() {
    const regs = await this.modbus.readInput(REG_BATTERY_POWER, 7); // 10008..10014
    return {
      soc: regs[6],
      batteryPower: this.invert ? -int32([regs[0], regs[1]]) : int32([regs[0], regs[1]]),
      solar: 0,
      sn: null,
      product: 'Anker SOLIX',
    };
  }

  async setPower(watts) {
    const w = Math.round(watts);
    if (!this.modeSet) {
      const [mode] = await this.modbus.readHolding(REG_MODE, 1);
      if (mode !== MODE_THIRD_PARTY) this.originalMode = mode;
      await this.modbus.writeSingle(REG_MODE, MODE_THIRD_PARTY);
      this.modeSet = true;
      this.lastSetpoint = null;
    }
    if (w === this.lastSetpoint) return;
    await this.modbus.writeMultiple(REG_SETPOINT, toInt32Words(w));
    this.lastSetpoint = w;
  }

  /** Set-point 0 and back to the operating mode the battery had before (default self-consumption). */
  async release() {
    try {
      await this.modbus.writeMultiple(REG_SETPOINT, toInt32Words(0));
      await this.modbus.writeSingle(REG_MODE, this.originalMode ?? 0);
    } finally {
      this.modeSet = false;
      this.lastSetpoint = null;
    }
  }

  close() {
    this.modbus.close();
  }

  static async identify(ip, { port = 502, unitId = 1 } = {}) {
    const client = new AnkerClient({ ip, port, unitId });
    try {
      const data = await client.read();
      if (data.soc < 0 || data.soc > 100) throw new Error(`Onverwacht laadniveau (${data.soc})`);
      const sn = regsToString(await client.modbus.readInput(REG_SN, 12)) || `${ip}-${unitId}`;
      const model = regsToString(await client.modbus.readInput(REG_MODEL, 5));
      return { id: `anker-${sn}`, name: `Anker SOLIX ${model || ''}`.trim(), store: { sn } };
    } finally {
      client.close();
    }
  }

}

module.exports = { AnkerClient };
