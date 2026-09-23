'use strict';

const net = require('net');

/**
 * Minimal Modbus TCP client (no dependencies): read holding/input registers and write
 * single/multiple registers. One persistent connection, requests are serialised.
 */
class ModbusTcp {

  constructor({
    host, port = 502, unitId = 1, timeout = 3000,
  }) {
    this.host = host;
    this.port = port;
    this.unitId = unitId;
    this.timeout = timeout;
    this.socket = null;
    this.transactionId = 0;
    this.queue = Promise.resolve();
    this.pending = null; // { id, resolve, reject, timer }
    this.buffer = Buffer.alloc(0);
  }

  connect() {
    if (this.socket && !this.socket.destroyed && this.connected) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      const timer = setTimeout(() => {
        socket.destroy(new Error(`Modbus: geen verbinding met ${this.host}:${this.port}`));
      }, this.timeout);
      socket.once('connect', () => {
        clearTimeout(timer);
        this.connected = true;
        resolve();
      });
      socket.on('data', (chunk) => this.onData(chunk));
      socket.on('error', (err) => {
        clearTimeout(timer);
        this.fail(err);
        reject(err);
      });
      socket.on('close', () => {
        this.connected = false;
        this.fail(new Error('Modbus: verbinding gesloten'));
      });
      this.socket = socket;
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }

  close() {
    if (this.socket) this.socket.destroy();
    this.socket = null;
    this.connected = false;
  }

  fail(err) {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.reject(err);
    this.pending = null;
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 7) {
      const length = this.buffer.readUInt16BE(4); // unit id + PDU
      if (this.buffer.length < 6 + length) return;
      const frame = this.buffer.subarray(0, 6 + length);
      this.buffer = this.buffer.subarray(6 + length);
      const id = frame.readUInt16BE(0);
      if (!this.pending || this.pending.id !== id) continue; // stale answer
      const { resolve, reject, timer } = this.pending;
      this.pending = null;
      clearTimeout(timer);
      const fc = frame[7];
      if (fc & 0x80) {
        reject(new Error(`Modbus-fout ${frame[8]} (${EXCEPTIONS[frame[8]] || 'onbekend'})`));
      } else {
        resolve(frame.subarray(7)); // PDU
      }
    }
  }

  /** Send a PDU and wait for the answer; requests run one after another. */
  request(pdu) {
    const run = async () => {
      await this.connect();
      this.transactionId = (this.transactionId + 1) & 0xffff;
      const id = this.transactionId;
      const header = Buffer.alloc(7);
      header.writeUInt16BE(id, 0);
      header.writeUInt16BE(0, 2); // protocol id
      header.writeUInt16BE(pdu.length + 1, 4);
      header.writeUInt8(this.unitId, 6);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending = null;
          this.close(); // resynchronise on the next request
          reject(new Error(`Modbus: geen antwoord van ${this.host}`));
        }, this.timeout);
        this.pending = {
          id, resolve, reject, timer,
        };
        this.socket.write(Buffer.concat([header, pdu]));
      });
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  async readRegisters(address, count, input = false) {
    const pdu = Buffer.alloc(5);
    pdu.writeUInt8(input ? 0x04 : 0x03, 0);
    pdu.writeUInt16BE(address, 1);
    pdu.writeUInt16BE(count, 3);
    const res = await this.request(pdu);
    const bytes = res[1];
    const regs = [];
    for (let i = 0; i < bytes / 2; i++) regs.push(res.readUInt16BE(2 + i * 2));
    return regs;
  }

  readHolding(address, count = 1) {
    return this.readRegisters(address, count, false);
  }

  readInput(address, count = 1) {
    return this.readRegisters(address, count, true);
  }

  async writeSingle(address, value) {
    const pdu = Buffer.alloc(5);
    pdu.writeUInt8(0x06, 0);
    pdu.writeUInt16BE(address, 1);
    pdu.writeUInt16BE(value & 0xffff, 3);
    await this.request(pdu);
  }

  async writeMultiple(address, values) {
    const pdu = Buffer.alloc(6 + values.length * 2);
    pdu.writeUInt8(0x10, 0);
    pdu.writeUInt16BE(address, 1);
    pdu.writeUInt16BE(values.length, 3);
    pdu.writeUInt8(values.length * 2, 5);
    values.forEach((v, i) => pdu.writeUInt16BE(v & 0xffff, 6 + i * 2));
    await this.request(pdu);
  }

}

const EXCEPTIONS = {
  1: 'functie niet ondersteund',
  2: 'ongeldig registeradres',
  3: 'ongeldige waarde',
  4: 'apparaatfout',
  6: 'apparaat bezet',
};

// ---- value helpers (big-endian word order, as used by Marstek and Anker)
const int16 = (r) => (r > 0x7fff ? r - 0x10000 : r);
const int32 = ([hi, lo]) => {
  const v = (hi << 16) | lo; // JS bitwise = signed 32-bit
  return v;
};
const uint32 = ([hi, lo]) => hi * 0x10000 + lo;
const toInt32Words = (value) => {
  const v = Math.round(value) >>> 0;
  return [(v >>> 16) & 0xffff, v & 0xffff];
};
const regsToString = (regs) => Buffer.from(regs.flatMap((r) => [r >> 8, r & 0xff]))
  .toString('latin1').replace(/\0+$/, '').trim();

module.exports = {
  ModbusTcp, int16, int32, uint32, toInt32Words, regsToString,
};
