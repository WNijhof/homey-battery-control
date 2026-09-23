'use strict';

const { requestJson } = require('./http');
const { fetchEntsoe } = require('./entsoe');

const API = 'https://public.api.energyzero.nl/public/v1/prices';

/**
 * Day-ahead electricity prices per quarter hour (EPEX, the same market prices Zonneplan uses),
 * fetched from the public EnergyZero API. Prices in EUR/kWh, market price incl. VAT.
 */
class PriceService {

  constructor({ timezone = 'Europe/Amsterdam', log = () => {}, error = () => {} } = {}) {
    this.timezone = timezone;
    this.log = log;
    this.error = error;
    this.slots = new Map(); // startMs -> { start, end, price }
    this.listeners = new Set();
  }

  onUpdate(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  formatDate(date) {
    // dd-mm-yyyy in the local time zone
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: this.timezone, day: '2-digit', month: '2-digit', year: 'numeric',
    }).formatToParts(date);
    const get = (type) => parts.find((p) => p.type === type).value;
    return `${get('day')}-${get('month')}-${get('year')}`;
  }

  async fetchDay(date) {
    const url = `${API}?date=${this.formatDate(date)}&interval=INTERVAL_QUARTER&energyType=ENERGY_TYPE_ELECTRICITY`;
    const json = await requestJson(url, { timeout: 15000 });
    const slots = json.base_with_vat || [];
    for (const s of slots) {
      const start = Date.parse(s.start);
      this.slots.set(start, { start, end: Date.parse(s.end), price: Number(s.price.value) });
    }
    return slots.length;
  }

  /** Optional backup source: ENTSO-E transparency platform (free token required). */
  setEntsoeToken(token) {
    this.entsoeToken = token || null;
  }

  async refresh() {
    const now = new Date();
    let primaryOk = true;
    try {
      await this.fetchDay(now);
    } catch (err) {
      primaryOk = false;
      this.error('EnergyZero prices today failed:', err.message);
    }
    try {
      await this.fetchDay(new Date(now.getTime() + 24 * 3600 * 1000));
    } catch (err) {
      // Tomorrow's prices are published around 13:00; failing before that is expected.
    }
    const needBackup = !primaryOk || this.lastSlotEnd() < Date.now() + 3 * 3600 * 1000;
    if (needBackup && this.entsoeToken) {
      try {
        const from = Date.now() - 24 * 3600 * 1000;
        const slots = await fetchEntsoe(this.entsoeToken, from, from + 72 * 3600 * 1000);
        for (const s of slots) if (!this.slots.has(s.start)) this.slots.set(s.start, s);
        this.log(`ENTSO-E backup: ${slots.length} slots`);
      } catch (err) {
        this.error('ENTSO-E backup failed:', err.message);
      }
    }
    const cutoff = Date.now() - 24 * 3600 * 1000;
    for (const key of this.slots.keys()) if (key < cutoff) this.slots.delete(key);
    this.log(`Prices: ${this.slots.size} slots known, until ${new Date(this.lastSlotEnd()).toISOString()}`);
    for (const fn of this.listeners) {
      try { fn(); } catch (err) { this.error(err); }
    }
  }

  lastSlotEnd() {
    let max = 0;
    for (const s of this.slots.values()) max = Math.max(max, s.end);
    return max;
  }

  /** All slots that have not ended yet, sorted by start. */
  futureSlots(now = Date.now()) {
    return [...this.slots.values()].filter((s) => s.end > now).sort((a, b) => a.start - b.start);
  }

}

module.exports = PriceService;
