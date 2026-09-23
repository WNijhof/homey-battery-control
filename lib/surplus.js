'use strict';

const SMOOTH_MS = 60 * 1000;
const KEEP_MS = 65 * 60 * 1000;

/**
 * Solar surplus = power that is currently going to the grid or into the battery from solar.
 *   surplus = max(0, batteryChargePower - gridPower)
 * (grid negative = export). Grid charging during a cheap slot does not count as surplus.
 *
 * Keeps a smoothed (1-minute average) history so Flows can ask
 * "has the surplus been above X W for Y minutes?".
 */
class SurplusTracker {

  constructor() {
    this.raw = []; // { t, v } last minute
    this.history = []; // { t, v } smoothed, last 65 minutes
  }

  static compute(batteryPower, gridPower) {
    const charge = Math.max(0, -batteryPower);
    return Math.max(0, Math.round(charge - gridPower));
  }

  add(value, t = Date.now()) {
    this.raw.push({ t, v: value });
    this.raw = this.raw.filter((s) => s.t > t - SMOOTH_MS);
    const avg = Math.round(this.raw.reduce((sum, s) => sum + s.v, 0) / this.raw.length);
    this.history.push({ t, v: avg });
    this.history = this.history.filter((s) => s.t > t - KEEP_MS);
    return avg;
  }

  current() {
    return this.history.length ? this.history[this.history.length - 1].v : 0;
  }

  /** True when every smoothed sample in [at - minutes, at] satisfies the comparison. */
  held(power, minutes, above, at = Date.now()) {
    const from = at - minutes * 60 * 1000;
    const window = this.history.filter((s) => s.t >= from && s.t <= at);
    // need history covering the whole window
    const oldest = this.history.find((s) => s.t <= at);
    if (!window.length || !oldest || oldest.t > from + 30 * 1000) return false;
    return window.every((s) => (above ? s.v >= power : s.v < power));
  }

}

module.exports = SurplusTracker;
