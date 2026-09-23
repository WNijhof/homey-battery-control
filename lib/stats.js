'use strict';

/**
 * Savings: value of battery energy at the all-in price of the moment.
 *   + discharged kWh × price   (energy you did not have to buy)
 *   − charged kWh × price      (energy you bought or did not export)
 * With net metering (saldering, NL until end 2026) export and import have the same value,
 * so this is the real benefit compared to having no battery.
 */
function savingsDelta(batteryPowerW, hours, price) {
  if (price === null || price === undefined || !Number.isFinite(price)) return 0;
  const kwh = (batteryPowerW * hours) / 1000; // + discharge, - charge
  return kwh * price;
}

/**
 * Learned round-trip efficiency from daily snapshots {date, charged, discharged, soc}.
 * efficiency = (discharged + change in stored energy) / charged, over up to 14 days.
 * Returns null while there is too little data (< minChargedKwh charged).
 */
function learnedEfficiency(snapshots, capacityKwh, { days = 14, minChargedKwh = 5 } = {}) {
  if (!snapshots || snapshots.length < 2) return null;
  const recent = snapshots.slice(-(days + 1));
  const a = recent[0];
  const b = recent[recent.length - 1];
  const charged = b.charged - a.charged;
  const discharged = b.discharged - a.discharged;
  if (charged < minChargedKwh) return null;
  const stored = (((b.soc ?? 0) - (a.soc ?? 0)) / 100) * capacityKwh;
  const eff = (discharged + stored) / charged;
  if (!Number.isFinite(eff)) return null;
  return Math.max(0.5, Math.min(0.98, eff));
}

module.exports = { savingsDelta, learnedEfficiency };
