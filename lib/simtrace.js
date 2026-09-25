'use strict';

const KEEP_MS = 10 * 60 * 1000;

/**
 * Short, fine-grained history of the simulation (real P1, simulated battery, grid with battery,
 * set-point) for the live chart on the web page. Filled by the control loop (every control
 * interval) and by the simulated P1 meter (every 1–2 s).
 * Signs: p1/grid + import / − export; battery/setpoint + discharge / − charge.
 */
class SimTrace {

  constructor(keepMs = KEEP_MS) {
    this.keepMs = keepMs;
    this.samples = []; // { t, p1, battery, grid, setpoint }
  }

  add({
    t = Date.now(), p1, battery, setpoint = null,
  }) {
    const sample = {
      t, p1, battery, grid: p1 - battery, setpoint,
    };
    // readings arrive from two loops; keep the list sorted by time
    let i = this.samples.length;
    while (i > 0 && this.samples[i - 1].t > t) i -= 1;
    this.samples.splice(i, 0, sample);
    const cutoff = this.samples[this.samples.length - 1].t - this.keepMs;
    while (this.samples.length && this.samples[0].t < cutoff) this.samples.shift();
    return sample;
  }

  recent(ms, now = Date.now()) {
    return this.samples.filter((s) => s.t >= now - ms);
  }

}

module.exports = { SimTrace };
