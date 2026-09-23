'use strict';

// node test/modbus.test.js — Modbus TCP client + Marstek/Anker adapters against a simulated device
const assert = require('assert');
const net = require('net');
const {
  ModbusTcp, int16, int32, toInt32Words,
} = require('../lib/modbus');
const { MarstekClient } = require('../lib/batteries/marstek');
const { AnkerClient } = require('../lib/batteries/anker');

/** Tiny Modbus TCP server: holding/input register maps, records every write. */
function fakeDevice({ holding = {}, input = {} }) {
  const writes = [];
  const server = net.createServer((socket) => {
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 7 && buf.length >= 6 + buf.readUInt16BE(4)) {
        const len = buf.readUInt16BE(4);
        const frame = buf.subarray(0, 6 + len);
        buf = buf.subarray(6 + len);
        const fc = frame[7];
        const addr = frame.readUInt16BE(8);
        let pdu;
        if (fc === 3 || fc === 4) {
          const count = frame.readUInt16BE(10);
          const map = fc === 3 ? holding : input;
          if ([...Array(count)].some((_, i) => map[addr + i] === undefined)) {
            pdu = Buffer.from([fc | 0x80, 2]); // illegal address
          } else {
            pdu = Buffer.alloc(2 + count * 2);
            pdu[0] = fc;
            pdu[1] = count * 2;
            for (let i = 0; i < count; i++) pdu.writeUInt16BE(map[addr + i] & 0xffff, 2 + i * 2);
          }
        } else if (fc === 6) {
          const value = frame.readUInt16BE(10);
          holding[addr] = value;
          writes.push([addr, value]);
          pdu = frame.subarray(7, 12);
        } else if (fc === 16) {
          const count = frame.readUInt16BE(10);
          const values = [];
          for (let i = 0; i < count; i++) values.push(frame.readUInt16BE(13 + i * 2));
          values.forEach((v, i) => { holding[addr + i] = v; });
          writes.push([addr, ...values]);
          pdu = frame.subarray(7, 12);
        }
        const head = Buffer.alloc(7);
        frame.copy(head, 0, 0, 4);
        head.writeUInt16BE(pdu.length + 1, 4);
        head[6] = frame[6];
        socket.write(Buffer.concat([head, pdu]));
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    port: server.address().port, writes, holding, close: () => server.close(),
  })));
}

(async () => {
  // value helpers
  assert.strictEqual(int16(0xffff), -1);
  assert.strictEqual(int32(toInt32Words(-800)), -800);
  assert.strictEqual(int32(toInt32Words(1234)), 1234);

  // raw client: serialised requests and exception handling
  let dev = await fakeDevice({ holding: { 100: 7, 101: 8 } });
  const mb = new ModbusTcp({ host: '127.0.0.1', port: dev.port });
  const [a, b] = await Promise.all([mb.readHolding(100, 1), mb.readHolding(101, 1)]);
  assert.deepStrictEqual([a, b], [[7], [8]], 'parallel requests answered in order');
  await assert.rejects(mb.readHolding(500, 1), /ongeldig registeradres/);
  mb.close();
  dev.close();

  // Marstek Venus E v3: SOC ×0.1, int16 AC power, RS485 enable + force mode
  dev = await fakeDevice({ holding: { 34002: 625, 30006: 0xfe70 /* -400 */ } });
  let m = new MarstekClient({ ip: '127.0.0.1', port: dev.port, profile: 'e_v3' });
  let r = await m.read();
  assert.strictEqual(r.soc, 62.5);
  assert.strictEqual(r.batteryPower, -400, 'negative = charging');
  await m.setPower(600);
  await m.setPower(600); // unchanged: no new writes
  await m.setPower(-800);
  await m.setPower(0);
  assert.deepStrictEqual(dev.writes, [
    [42000, 21930], [42021, 600], [42010, 2], [42020, 800], [42010, 1], [42010, 0],
  ], 'Marstek register sequence');
  await m.release();
  assert.deepStrictEqual(dev.writes.slice(-2), [[42010, 0], [42000, 21947]], 'release: RS485 control off');
  m.close();
  dev.close();

  // Marstek Venus E v1/v2: int32 AC power at 32202, invert option
  dev = await fakeDevice({ holding: { 32104: 80, 32202: 0, 32203: 500 } });
  m = new MarstekClient({
    ip: '127.0.0.1', port: dev.port, profile: 'e_v12', invert: true,
  });
  r = await m.read();
  assert.deepStrictEqual([r.soc, r.batteryPower], [80, -500], 'v1/v2 map with inverted sign');
  m.close();
  dev.close();

  // Anker: third-party mode, signed INT32 set-point, restore original mode
  dev = await fakeDevice({
    input: {
      10008: 0xffff, 10009: 0xfe0c /* -500 */, 10010: 0, 10011: 0, 10012: 0, 10013: 300, 10014: 55,
    },
    holding: { 10064: 6 },
  });
  const anker = new AnkerClient({ ip: '127.0.0.1', port: dev.port });
  r = await anker.read();
  assert.deepStrictEqual([r.soc, r.batteryPower], [55, -500], 'Anker SOC and battery power');
  await anker.setPower(-700);
  await anker.setPower(-700); // unchanged
  await anker.setPower(400);
  const words = (w) => toInt32Words(w);
  assert.deepStrictEqual(dev.writes, [
    [10064, 3], [10071, ...words(-700)], [10071, ...words(400)],
  ], 'Anker register sequence');
  await anker.release();
  assert.deepStrictEqual(dev.writes.slice(-2), [[10071, 0, 0], [10064, 6]], 'release: original mode (smart) restored');
  anker.close();
  dev.close();

  console.log('modbus tests ok');
})().catch((err) => { console.error(err); process.exit(1); });
