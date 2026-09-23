'use strict';

const { request } = require('./http');

const API = 'https://web-api.tp.entsoe.eu/api';
const NL = '10YNL----------L';

const pad = (n) => String(n).padStart(2, '0');
const fmt = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}00`;
};

const RESOLUTION_MS = { PT15M: 900000, PT30M: 1800000, PT60M: 3600000 };

/**
 * Parse an ENTSO-E day-ahead price document (A44) into quarter-hour slots.
 * Prices are EUR/MWh excl. VAT; returned as EUR/kWh incl. 21 % VAT (same basis as EnergyZero).
 * Positions may be omitted (curve type A03): the previous price then continues.
 */
function parseEntsoe(xml) {
  const slots = [];
  const periods = xml.split('<Period>').slice(1);
  for (const period of periods) {
    const start = Date.parse(/<start>([^<]+)<\/start>/.exec(period)[1]);
    const end = Date.parse(/<end>([^<]+)<\/end>/.exec(period)[1]);
    const step = RESOLUTION_MS[/<resolution>([^<]+)<\/resolution>/.exec(period)[1]];
    if (!step) continue;
    const prices = new Map();
    const re = /<Point>\s*<position>(\d+)<\/position>\s*<price\.amount>([-\d.]+)<\/price\.amount>/g;
    let m;
    while ((m = re.exec(period))) prices.set(Number(m[1]), Number(m[2]));
    const count = Math.round((end - start) / step);
    let last = null;
    for (let pos = 1; pos <= count; pos++) {
      if (prices.has(pos)) last = prices.get(pos);
      if (last === null) continue;
      const s = start + (pos - 1) * step;
      // split hourly/half-hourly prices into quarter hours
      for (let q = s; q < s + step; q += 900000) {
        slots.push({ start: q, end: q + 900000, price: (last / 1000) * 1.21 });
      }
    }
  }
  return slots;
}

async function fetchEntsoe(token, fromMs, toMs) {
  const url = `${API}?securityToken=${encodeURIComponent(token)}&documentType=A44`
    + `&in_Domain=${NL}&out_Domain=${NL}&periodStart=${fmt(fromMs)}&periodEnd=${fmt(toMs)}`;
  const xml = await request(url, { raw: true, timeout: 20000 });
  return parseEntsoe(xml);
}

module.exports = { parseEntsoe, fetchEntsoe };
