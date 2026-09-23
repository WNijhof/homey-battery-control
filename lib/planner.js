'use strict';

/**
 * Dynamic price planner.
 *
 * For every future quarter-hour slot decide:
 *   charge    – charge from the grid at full power (cheap slots)
 *   discharge – supply the house (zero-grid), or export when allowed
 *   hold      – keep the energy for later; only charge from solar surplus
 *
 * Steps:
 *  1. Candidates: slots with price >= avg(cheapest n) / efficiency + minSpread are discharge
 *     candidates (n = quarter hours needed to fill the usable capacity). Before every block of
 *     discharge slots, the n cheapest slots since the previous block are charge candidates when
 *     the round trip to that block is profitable. Negative prices always mean charging.
 *  2. Between two charge windows only the most expensive discharge slots that a full battery
 *     can cover at the average house load (avgLoadW) stay discharge; the rest become hold.
 *  3. Energy simulation in time order: start from the current state of charge, add the expected
 *     solar surplus, subtract the house load in discharge slots. Only when energy runs short,
 *     the cheapest earlier charge candidate that is profitable for that slot is activated.
 *     Unused candidates become hold, so the battery never buys grid energy that the plan will
 *     not use or that the sun will deliver.
 */
function makePlan(slots, opts) {
  const {
    capacityKwh, minSoc, maxSoc, maxChargeW, maxDischargeW = Infinity, efficiency, minSpread,
    markup = 0, avgLoadW = 0, soc = null, solarSurplusW = null,
  } = opts;
  if (!slots.length) return { slots: [], dischargeThreshold: null };

  const priced = slots.map((s) => ({
    start: s.start,
    end: s.end,
    price: s.price + markup,
    solarW: solarSurplusW ? Math.round(solarSurplusW(s.start, s.end)) : 0,
  }));
  const usableKwh = Math.max(0.1, (capacityKwh * (maxSoc - minSoc)) / 100);
  const kwhPerSlot = Math.max(0.01, (maxChargeW / 1000) * 0.25 * efficiency);
  const nCharge = Math.max(1, Math.ceil(usableKwh / kwhPerSlot));

  const cheapest = [...priced].sort((a, b) => a.price - b.price).slice(0, nCharge);
  const refLow = cheapest.reduce((sum, s) => sum + s.price, 0) / cheapest.length;
  const dischargeThreshold = Math.max(refLow, 0) / efficiency + minSpread;

  // 1. candidates: discharge above the threshold; per expensive block the n cheapest slots
  //    in the window before it are charge candidates (when profitable for that block)
  const planned = priced.map((slot) => {
    let action = 'hold';
    if (slot.price < 0) action = 'charge';
    else if (slot.price >= dischargeThreshold) action = 'discharge';
    return { ...slot, action };
  });
  let windowStart = 0;
  for (let b = 0; b < planned.length; b++) {
    if (planned[b].action !== 'discharge' || (b > 0 && planned[b - 1].action === 'discharge')) continue;
    let e = b;
    while (e + 1 < planned.length && planned[e + 1].action === 'discharge') e++;
    const blockMax = Math.max(...planned.slice(b, e + 1).map((s) => s.price));
    planned.slice(windowStart, b)
      .filter((s) => s.action === 'hold')
      .sort((x, y) => x.price - y.price)
      .slice(0, nCharge)
      .filter((s) => blockMax * efficiency - s.price >= minSpread)
      .forEach((s) => { s.action = 'charge'; });
    windowStart = e + 1;
    b = e;
  }

  // 2. keep only the most expensive discharge slots per window
  const loadKwh = (Math.min(avgLoadW, maxDischargeW) / 1000) * 0.25;
  if (avgLoadW > 0) {
    const nDischarge = Math.max(1, Math.ceil((usableKwh * efficiency) / Math.max(0.01, loadKwh)));
    let segment = [];
    const flush = () => {
      segment.sort((a, b) => b.price - a.price).slice(nDischarge).forEach((s) => { s.action = 'hold'; });
      segment = [];
    };
    for (const slot of planned) {
      if (slot.action === 'charge') flush();
      else if (slot.action === 'discharge') segment.push(slot);
    }
    flush();

    // 3. only buy the grid energy that is actually needed
    allocateCharging(planned, {
      usableKwh,
      kwhPerSlot,
      loadKwh,
      maxChargeW,
      efficiency,
      minSpread,
      stored: soc === null || soc === undefined ? 0 : (capacityKwh * (soc - minSoc)) / 100,
    });
  }

  return { slots: planned, dischargeThreshold };
}

function allocateCharging(planned, {
  usableKwh, kwhPerSlot, loadKwh, maxChargeW, efficiency, minSpread, stored,
}) {
  const clamp = (e) => Math.max(0, Math.min(usableKwh, e));
  let energy = clamp(stored);
  const unused = [];
  const used = new Set();

  for (const slot of planned) {
    if (slot.action === 'charge') {
      if (slot.price < 0) {
        used.add(slot); // negative price: always charge
        energy = clamp(energy + kwhPerSlot);
      } else {
        unused.push(slot);
      }
      continue;
    }
    energy = clamp(energy + (Math.min(slot.solarW, maxChargeW) / 1000) * 0.25 * efficiency);
    if (slot.action === 'discharge') {
      // only charge slots that are profitable for this discharge slot
      const maxBuy = slot.price * efficiency - minSpread;
      while (energy < loadKwh) {
        let best = -1;
        for (let k = 0; k < unused.length; k++) {
          if (unused[k].price <= maxBuy && (best === -1 || unused[k].price < unused[best].price)) best = k;
        }
        if (best === -1) break;
        used.add(unused.splice(best, 1)[0]);
        energy = clamp(energy + kwhPerSlot);
      }
      energy = clamp(energy - loadKwh);
    }
  }

  for (const slot of planned) {
    if (slot.action === 'charge' && !used.has(slot)) {
      slot.action = 'hold';
      slot.notNeeded = true;
    }
  }
}

function slotAt(planSlots, now = Date.now()) {
  return planSlots.find((s) => s.start <= now && s.end > now) || null;
}

module.exports = { makePlan, slotAt };
