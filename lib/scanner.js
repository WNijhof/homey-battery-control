'use strict';

const net = require('net');
const ZendureClient = require('./batteries/zendure');
const HomeWizardP1 = require('./homewizard');

/** Is a TCP port open on this host? */
function portOpen(ip, port, timeout) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: ip, port });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeout, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/**
 * Scan the local /24 subnet for batteries and HomeWizard meters.
 *   zendure:    Zendure SolarFlow (zenSDK HTTP API)
 *   modbusPort: hosts with this TCP port open (Marstek / Anker / RS485 bridges)
 * ~254 short probes with limited concurrency; takes about 5–20 s.
 */
async function scanNetwork(ownIp, {
  zendure = true, modbusPort = null, concurrency = 32, timeout = 1500,
} = {}) {
  const base = ownIp.split('.').slice(0, 3).join('.');
  const ips = [];
  for (let i = 1; i < 255; i++) {
    const ip = `${base}.${i}`;
    if (ip !== ownIp) ips.push(ip);
  }

  const found = { zendure: [], modbus: [], homewizard: [] };
  let next = 0;
  const worker = async () => {
    while (next < ips.length) {
      const ip = ips[next++];
      const [z, h, m] = await Promise.allSettled([
        zendure ? new ZendureClient(ip).report({ timeout }) : Promise.reject(),
        HomeWizardP1.identify(ip, timeout),
        modbusPort ? portOpen(ip, modbusPort, timeout) : Promise.resolve(false),
      ]);
      if (z.status === 'fulfilled' && z.value.sn) {
        found.zendure.push({ ip, label: `${z.value.product || 'SolarFlow'} (${z.value.sn})` });
      }
      if (h.status === 'fulfilled') found.homewizard.push(h.value);
      if (m.status === 'fulfilled' && m.value) found.modbus.push({ ip, label: `Modbus TCP op ${ip}` });
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const byIp = (a, b) => Number(a.ip.split('.')[3]) - Number(b.ip.split('.')[3]);
  return {
    zendure: found.zendure.sort(byIp),
    modbus: found.modbus.sort(byIp),
    homewizard: found.homewizard.sort(byIp),
  };
}

module.exports = { scanNetwork, portOpen };
