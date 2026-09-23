'use strict';

const ZendureClient = require('./zendure');
const HomeWizardP1 = require('./homewizard');

/**
 * Scan the local /24 subnet for Zendure SolarFlow devices (zenSDK) and HomeWizard meters.
 * ~254 short HTTP probes with limited concurrency; takes about 5–15 s.
 */
async function scanNetwork(ownIp, { concurrency = 32, timeout = 1500 } = {}) {
  const base = ownIp.split('.').slice(0, 3).join('.');
  const ips = [];
  for (let i = 1; i < 255; i++) {
    const ip = `${base}.${i}`;
    if (ip !== ownIp) ips.push(ip);
  }

  const zendure = [];
  const homewizard = [];
  let next = 0;
  const worker = async () => {
    while (next < ips.length) {
      const ip = ips[next++];
      const [z, h] = await Promise.allSettled([
        new ZendureClient(ip).report({ timeout }),
        HomeWizardP1.identify(ip, timeout),
      ]);
      if (z.status === 'fulfilled' && z.value.sn) {
        zendure.push({ ip, sn: z.value.sn, product: z.value.product || 'SolarFlow' });
      }
      if (h.status === 'fulfilled') homewizard.push(h.value);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const byIp = (a, b) => Number(a.ip.split('.')[3]) - Number(b.ip.split('.')[3]);
  return { zendure: zendure.sort(byIp), homewizard: homewizard.sort(byIp) };
}

module.exports = { scanNetwork };
