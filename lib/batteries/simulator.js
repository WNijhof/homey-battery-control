'use strict';

/**
 * Simulated home battery with the measured behaviour of a Zendure SolarFlow 2400 AC+.
 * Nothing is written anywhere: the battery only exists in memory (state saved via onState).
 *
 * Model (defaults from reviews, see the manual):
 *  - Conversion loss per direction: loss(P) = overheadW + k·P (P = AC power).
 *    k follows from the round-trip efficiency measured at REVIEW_POWER_W (88 % at 800 W).
 *    With overheadW = 8 W the round trip drops to ~81 % at 150 W and ~65 % at 50 W,
 *    in line with the 78–82 % that reviews measured in zero-grid mode at 100–200 W.
 *  - Idle: standbyW drawn from the grid (0.7 W) and idleDrainW from the cells (2.7 W).
 *  - Response: a new set-point takes effect after delayS seconds and then ramps at rampWps W/s.
 *  - Charging tapers above taperFromSoc (constant-voltage phase), the BMS stops at minSoc / 100 %.
 *
 * Same interface as the real batteries: read(), setPower(w), release(), close().
 */
const REVIEW_POWER_W = 800;
const STEP_S = 1;
const MAX_STEPPED_GAP_S = 15 * 60; // longer gaps (app stopped): battery was idle
const STATE_SAVE_MS = 60 * 1000;

const DEFAULTS = {
  capacityKwh: 2.4,
  maxChargeW: 800,
  maxDischargeW: 800,
  minSoc: 10,
  maxSoc: 100,
  rte: 0.88,
  overheadW: 8,
  standbyW: 0.7,
  idleDrainW: 2.7,
  delayS: 3,
  rampWps: 200,
  taperFromSoc: 95,
  soc: 50,
};

class SimulatedBattery {

  constructor(options = {}) {
    this.opts = { ...DEFAULTS, ...options };
    this.now = options.now || (() => Date.now());
    this.onState = options.onState || null;
    this.simulated = true;
    this.capacityWh = this.opts.capacityKwh * 1000;
    this.energyWh = (this.capacityWh * Math.max(0, Math.min(100, this.opts.soc))) / 100;
    this.acPower = 0; // actual AC power, + discharge / − charge
    this.setpoint = 0;
    this.pending = []; // { at, watts }
    // continue from the saved state: the time the app was stopped counts as idle time
    this.t = Math.min(this.now(), options.since ?? Infinity);
    this.lastSave = this.t;
    this.totals = {
      acInWh: 0, acOutWh: 0, lossWh: 0, standbyWh: 0,
    };
    // proportional part of the conversion loss, so that the round trip at REVIEW_POWER_W equals rte
    this.k = Math.max(0, 1 - Math.sqrt(this.opts.rte) - this.opts.overheadW / REVIEW_POWER_W);
  }

  /** Conversion loss in W for an AC power of p W (either direction). */
  loss(p) {
    return p > 0 ? this.opts.overheadW + this.k * p : 0;
  }

  soc() {
    return (this.energyWh / this.capacityWh) * 100;
  }

  /** Charge power the cells accept at this state of charge (constant-voltage taper near full). */
  chargeLimit() {
    const { maxChargeW, taperFromSoc } = this.opts;
    const soc = this.soc();
    if (soc <= taperFromSoc || taperFromSoc >= 100) return maxChargeW;
    return maxChargeW * Math.max(0.15, (100 - soc) / (100 - taperFromSoc));
  }

  advance(to = this.now()) {
    let remaining = (to - this.t) / 1000;
    if (remaining <= 0) return;
    if (remaining > MAX_STEPPED_GAP_S) {
      // app was not running: the battery stood idle
      this.idle(remaining - MAX_STEPPED_GAP_S);
      this.pending = [];
      this.setpoint = 0;
      this.acPower = 0;
      this.t = to - MAX_STEPPED_GAP_S * 1000;
      remaining = MAX_STEPPED_GAP_S;
    }
    while (remaining > 1e-9) {
      const dt = Math.min(STEP_S, remaining);
      this.t += dt * 1000;
      this.step(dt);
      remaining -= dt;
    }
    this.t = to;
    if (this.onState && to - this.lastSave >= STATE_SAVE_MS) {
      this.lastSave = to;
      this.onState(this.state());
    }
  }

  step(dt) {
    while (this.pending.length && this.pending[0].at <= this.t) this.setpoint = this.pending.shift().watts;

    // what the battery management allows right now
    const { maxDischargeW, minSoc, maxSoc } = this.opts;
    const soc = this.soc();
    let wanted = this.setpoint;
    if (wanted < 0) wanted = soc >= Math.min(100, maxSoc) ? 0 : Math.max(wanted, -this.chargeLimit());
    if (wanted > 0) wanted = soc <= minSoc ? 0 : Math.min(wanted, maxDischargeW);

    // ramp towards it
    const maxStep = this.opts.rampWps * dt;
    this.acPower += Math.max(-maxStep, Math.min(maxStep, wanted - this.acPower));

    const hours = dt / 3600;
    if (Math.abs(this.acPower) < 1) {
      this.acPower = 0;
      this.idle(dt);
    } else if (this.acPower < 0) {
      const p = -this.acPower;
      const loss = Math.min(p, this.loss(p));
      this.energyWh += (p - loss) * hours;
      this.totals.acInWh += p * hours;
      this.totals.lossWh += loss * hours;
    } else {
      const p = this.acPower;
      const loss = this.loss(p);
      this.energyWh -= (p + loss) * hours;
      this.totals.acOutWh += p * hours;
      this.totals.lossWh += loss * hours;
    }
    if (this.energyWh <= 0 && this.acPower > 0) this.acPower = 0;
    if (this.energyWh >= this.capacityWh && this.acPower < 0) this.acPower = 0;
    this.energyWh = Math.max(0, Math.min(this.capacityWh, this.energyWh));
  }

  idle(seconds) {
    const hours = seconds / 3600;
    this.energyWh = Math.max(0, this.energyWh - this.opts.idleDrainW * hours);
    this.totals.standbyWh += (this.opts.standbyW + this.opts.idleDrainW) * hours;
  }

  /** AC power as a meter would see it: idle, the battery still draws its standby power. */
  meteredPower() {
    return this.acPower === 0 ? -this.opts.standbyW : this.acPower;
  }

  async read() {
    this.advance();
    return {
      soc: Math.round(this.soc()),
      socExact: this.soc(),
      batteryPower: Math.round(this.meteredPower()),
      solar: 0,
      sn: 'simulatie',
      product: 'Simulatie SolarFlow 2400 AC+',
    };
  }

  async setPower(watts) {
    this.advance();
    this.pending.push({ at: this.t + this.opts.delayS * 1000, watts: Math.round(watts) });
  }

  async release() {
    return this.setPower(0);
  }

  state() {
    return { soc: this.soc(), time: this.t };
  }

  close() {
    this.advance();
    if (this.onState) this.onState(this.state());
  }

  static identify() {
    return {
      id: `simulatie-${Date.now().toString(36)}`,
      name: 'Simulatie SolarFlow 2400 AC+',
      store: {},
    };
  }

}

module.exports = { SimulatedBattery, SIM_DEFAULTS: DEFAULTS, REVIEW_POWER_W };
