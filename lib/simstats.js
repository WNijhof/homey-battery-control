'use strict';

const MAX_GAP_HOURS = 0.1;
const KEEP_DAYS = 62;

const FIELDS = [
  'hours', // measured time
  'realImport', 'realExport', // kWh at the P1 meter (the house without battery)
  'simImport', 'simExport', // kWh as the grid would be with the simulated battery
  'charged', 'discharged', // kWh AC into / out of the battery
  'solarCharged', 'gridCharged', // charged from solar surplus / from the grid
  'dischargeHome', 'dischargeExport', // discharged into the house / exported
  'costReal', 'costSim', // € with net metering (saldering): export is worth the all-in price
  'costRealNoNet', 'costSimNoNet', // € without net metering: export earns the market price only
  'pricedHours', // part of the time with a known price
];

const empty = () => Object.fromEntries(FIELDS.map((f) => [f, 0]));

/**
 * Bookkeeping of the simulated battery: what the grid would have done with the battery compared to
 * what the P1 meter really measured (house, solar panels and everything else, without battery).
 * Kept per local day and in total.
 */
class SimulationStats {

  constructor({ saved = null, formatDate }) {
    this.formatDate = formatDate;
    this.days = (saved && saved.days) || [];
    this.total = (saved && saved.total) || { ...empty(), since: null };
    this.last = null;
  }

  day(date) {
    let d = this.days.find((x) => x.date === date);
    if (!d) {
      d = { date, ...empty(), socMin: null, socMax: null };
      this.days.push(d);
      this.days = this.days.slice(-KEEP_DAYS);
    }
    return d;
  }

  /**
   * @param {object} s
   * @param {number} s.t              time (ms)
   * @param {number} s.realGrid       P1 power, + import / − export (without battery)
   * @param {number} s.batteryPower   simulated battery, + discharge / − charge
   * @param {number|null} s.price     all-in import price €/kWh
   * @param {number|null} s.exportPrice  price paid for export without net metering €/kWh
   * @param {number|null} s.soc
   */
  add({
    t, realGrid, batteryPower, price, exportPrice, soc,
  }) {
    const prev = this.last;
    this.last = t;
    if (prev === null) return;
    const hours = (t - prev) / 3600000;
    if (!(hours > 0) || hours > MAX_GAP_HOURS) return;

    const kwh = (w) => (w * hours) / 1000;
    const simGrid = realGrid - batteryPower;
    const charge = Math.max(0, -batteryPower);
    const discharge = Math.max(0, batteryPower);
    const surplus = Math.max(0, -realGrid);
    const demand = Math.max(0, realGrid);

    const delta = {
      hours,
      realImport: kwh(Math.max(0, realGrid)),
      realExport: kwh(Math.max(0, -realGrid)),
      simImport: kwh(Math.max(0, simGrid)),
      simExport: kwh(Math.max(0, -simGrid)),
      charged: kwh(charge),
      discharged: kwh(discharge),
      solarCharged: kwh(Math.min(charge, surplus)),
      gridCharged: kwh(Math.max(0, charge - surplus)),
      dischargeHome: kwh(Math.min(discharge, demand)),
      dischargeExport: kwh(Math.max(0, discharge - demand)),
    };
    if (price !== null && price !== undefined && Number.isFinite(price)) {
      const feedIn = Number.isFinite(exportPrice) ? exportPrice : price;
      const cost = (grid) => kwh(grid) * price;
      const costNoNet = (grid) => (grid > 0 ? kwh(grid) * price : kwh(grid) * feedIn);
      Object.assign(delta, {
        costReal: cost(realGrid),
        costSim: cost(simGrid),
        costRealNoNet: costNoNet(realGrid),
        costSimNoNet: costNoNet(simGrid),
        pricedHours: hours,
      });
    }

    const d = this.day(this.formatDate(new Date(t)));
    for (const target of [d, this.total]) {
      for (const [k, v] of Object.entries(delta)) target[k] += v;
    }
    if (!this.total.since) this.total.since = d.date;
    if (soc !== null && soc !== undefined) {
      d.socMin = d.socMin === null ? soc : Math.min(d.socMin, soc);
      d.socMax = d.socMax === null ? soc : Math.max(d.socMax, soc);
    }
  }

  reset() {
    this.days = [];
    this.total = { ...empty(), since: null };
    this.last = null;
  }

  toJSON() {
    return { days: this.days, total: this.total };
  }

  /** Derived figures for one period (a day or the total). */
  static summary(p, capacityKwh) {
    const r2 = (v) => Math.round(v * 100) / 100;
    const r3 = (v) => Math.round(v * 1000) / 1000;
    return {
      ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === 'number' ? r3(v) : v])),
      savings: r2(p.costReal - p.costSim),
      savingsNoNet: r2(p.costRealNoNet - p.costSimNoNet),
      importAvoided: r3(p.realImport - p.simImport),
      cycles: capacityKwh > 0 ? r2(p.discharged / capacityKwh) : null,
      // share of the solar export that the battery kept in the house
      solarUsed: p.realExport > 0 ? Math.round((1 - p.simExport / p.realExport) * 100) : null,
    };
  }

}

module.exports = { SimulationStats, FIELDS };
