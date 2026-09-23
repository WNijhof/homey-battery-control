'use strict';

const Homey = require('homey');
const HomeWizardP1 = require('./homewizard');
const { makePlan, slotAt } = require('./planner');
const { computeTarget, shouldSend, goalFollowUp } = require('./controller');
const SurplusTracker = require('./surplus');
const { SolarForecast } = require('./forecast');
const { savingsDelta, learnedEfficiency } = require('./stats');

const PLAN_INTERVAL_MS = 60 * 1000;
const SURPLUS_EVAL_MS = 30 * 1000;
const FORECAST_INTERVAL_MS = 60 * 60 * 1000;
// After this many failed P1 readings the battery goes to stand-by (it would otherwise
// keep executing its last set-point without feedback).
const P1_FAILURES_BEFORE_IDLE = 3;
const FAILURES_BEFORE_UNAVAILABLE = 5;

// Strategies that cannot work without a grid measurement
const NEEDS_P1 = new Set(['self_consumption', 'solar_only', 'zero_import', 'peak_shaving', 'dynamic']);

const ADDED_CAPABILITIES = [
  'measure_power.surplus',
  'battery_savings_today',
  'battery_savings_total',
  'battery_efficiency',
  'solar_forecast_today',
  'measure_power.setpoint',
];

/**
 * Shared battery device: control loop, price plan, demo mode, savings, web data.
 * Brand drivers only implement createBatteryClient() (see lib/batteries/*).
 */
class BatteryDevice extends Homey.Device {

  /** @abstract returns an object with read(), setPower(w), release(), close() */
  createBatteryClient() {
    throw new Error('createBatteryClient() not implemented');
  }

  // Everything the device logs also goes into the app's logbook (downloadable via the web page)
  log(...args) {
    super.log(...args);
    this.logbookAdd('info', args);
  }

  error(...args) {
    super.error(...args);
    this.logbookAdd('error', args);
  }

  logbookAdd(level, args) {
    const logbook = this.homey && this.homey.app && this.homey.app.logbook;
    if (logbook) logbook.add(level, this.getName ? this.getName() : 'batterij', ...args);
  }

  /** One compact data line per minute: enough to reconstruct what the control did. */
  logDataLine({
    bat, meter, target, reason, strategy, cfg,
  }) {
    const now = Date.now();
    if (this.lastDataLine && now - this.lastDataLine < 60 * 1000) return;
    this.lastDataLine = now;
    const slot = slotAt(this.plan.slots);
    this.logbookAdd('data', [[
      `soc=${bat.soc}%`,
      `batterij=${bat.batteryPower}W`,
      `net=${meter ? `${meter.gridPower}W` : 'n.b.'}`,
      `gewenst=${target}W`,
      `overschot=${this.surplus.current()}W`,
      `strategie=${strategy}`,
      `plan=${slot ? slot.action : 'geen'}`,
      `prijs=${slot ? slot.price.toFixed(3) : 'n.b.'}`,
      cfg.demo ? 'DEMO' : 'LIVE',
      `(${reason})`,
    ].join(' ')]);
  }

  async onInit() {
    // settings migration: zendure_ip → battery_ip (v0.5.0)
    const oldIp = this.getSetting('zendure_ip');
    if (oldIp && !this.getSetting('battery_ip')) await this.setSettings({ battery_ip: oldIp }).catch(this.error);

    for (const cap of ADDED_CAPABILITIES) {
      if (!this.hasCapability(cap)) await this.addCapability(cap).catch(this.error);
    }
    if (!this.getCapabilityValue('battery_strategy')) {
      await this.setCapabilityValue('battery_strategy', 'self_consumption');
    }
    this.registerCapabilityListener('battery_strategy', (value) => this.onStrategyChanged(value));

    this.lastCommand = null;
    this.lastTick = null;
    this.failures = 0;
    this.p1Failures = 0;
    this.lastSoc = null;
    this.plan = { slots: [], dischargeThreshold: null };
    this.surplus = new SurplusTracker();
    this.lastSurplusEval = null;
    this.forecast = new SolarForecast({
      timezone: this.homey.clock.getTimezone() || 'Europe/Amsterdam',
      log: this.log.bind(this),
    });

    this.createClients();
    this.homey.app.prices.setEntsoeToken(this.getSetting('entsoe_token'));
    this.unsubscribePrices = this.homey.app.prices.onUpdate(() => this.updatePlan());
    this.updatePlan();
    this.planTimer = this.homey.setInterval(() => this.updatePlan(), PLAN_INTERVAL_MS);

    this.refreshForecast();
    this.forecastTimer = this.homey.setInterval(() => this.refreshForecast(), FORECAST_INTERVAL_MS);

    this.scheduleTick(1000);
    this.homey.setTimeout(() => this.homey.app.updateWebServer(), 1000);
  }

  createClients() {
    if (this.battery) this.battery.close();
    this.battery = this.createBatteryClient();
    this.p1 = new HomeWizardP1(this.getSetting('p1_ip'), this.getSetting('p1_token'));
  }

  get cfg() {
    const s = this.getSettings();
    const learned = s.auto_efficiency ? this.getCapabilityValue('battery_efficiency') : null;
    // several batteries on one P1 meter: share the correction, otherwise they overshoot together
    const batteries = Math.max(1, this.homey.app.batteries().length);
    return {
      interval: s.interval * 1000,
      capacityKwh: s.capacity_kwh,
      maxChargeW: s.max_charge_w,
      maxDischargeW: s.max_discharge_w,
      minSoc: s.min_soc,
      maxSoc: s.max_soc,
      efficiency: learned ? learned / 100 : s.efficiency / 100,
      gridTarget: s.grid_target / batteries,
      gain: s.gain / batteries,
      deadband: s.deadband,
      minPower: s.min_power,
      forceChargeW: s.force_charge_w,
      forceDischargeW: s.force_discharge_w,
      peakThreshold: s.peak_threshold / batteries,
      markup: s.markup + s.tax_per_kwh,
      minSpread: s.min_spread,
      dynLow: s.dyn_low,
      dynNeutral: s.dyn_neutral,
      dynHigh: s.dyn_high,
      // selling in expensive slots empties the battery at full power
      avgLoadW: s.dyn_high === 'sell' ? s.max_discharge_w : s.avg_load_w,
      importLimit: s.grid_import_limit / batteries,
      exportLimit: s.grid_export_limit / batteries,
      switchHysteresis: s.switch_hysteresis,
      chargeGoalSoc: s.charge_goal_soc,
      dischargeGoalSoc: s.discharge_goal_soc,
      followUp: s.follow_up_strategy,
      dayLoadW: s.day_load_w,
      forecastEnabled: s.forecast_enabled && s.pv_kwp > 0,
      demo: s.demo_mode,
    };
  }

  // ---- strategy -----------------------------------------------------------

  async setStrategy(strategy) {
    await this.setCapabilityValue('battery_strategy', strategy);
    await this.onStrategyChanged(strategy);
  }

  async onStrategyChanged(strategy) {
    this.log('Strategy ->', strategy);
    this.lastCommand = null; // force a new command on the next tick
    this.lastTarget = 0; // the hysteresis starts fresh for the new strategy
    this.homey.app.triggers.strategyChanged.trigger(this, { strategy }).catch(this.error);
    this.scheduleTick(200);
  }

  // ---- solar forecast -----------------------------------------------------

  async refreshForecast() {
    const s = this.getSettings();
    if (!s.forecast_enabled || !(s.pv_kwp > 0)) return;
    try {
      await this.forecast.refresh({
        lat: this.homey.geolocation.getLatitude(),
        lon: this.homey.geolocation.getLongitude(),
        tilt: s.pv_tilt,
        azimuth: s.pv_azimuth,
        kwp: s.pv_kwp,
      });
      await this.setCapabilityValue('solar_forecast_today', Math.round(this.forecast.energyToday() * 10) / 10);
      this.updatePlan();
    } catch (err) {
      this.error('Solar forecast failed:', err.message);
    }
  }

  // ---- price plan ---------------------------------------------------------

  updatePlan() {
    const cfg = this.cfg;
    const slots = this.homey.app.prices.futureSlots();
    const useForecast = cfg.forecastEnabled && this.forecast.hasData();
    this.plan = makePlan(slots, {
      ...cfg,
      soc: this.lastSoc,
      solarSurplusW: useForecast
        ? (start, end) => Math.max(0, this.forecast.averageWatts(start, end) - cfg.dayLoadW)
        : null,
    });
    const current = slotAt(this.plan.slots);

    const price = current ? current.price : null;
    const action = current ? current.action : 'none';
    this.currentPrice = price;
    this.setCapabilityValue('energy_price', price !== null ? Math.round(price * 1000) / 1000 : null).catch(this.error);

    if (this.getCapabilityValue('battery_plan') !== action) {
      this.setCapabilityValue('battery_plan', action).catch(this.error);
      this.homey.app.triggers.planChanged.trigger(this, { action, price: price || 0 }).catch(this.error);
      this.log(`Plan: ${action} @ €${price} (discharge above €${this.plan.dischargeThreshold?.toFixed(3)})`);
    }
  }

  /** Data for the dashboard widget. */
  getWidgetData() {
    return {
      name: this.getName(),
      soc: this.getCapabilityValue('measure_battery'),
      power: this.getCapabilityValue('measure_power'),
      strategy: this.getCapabilityValue('battery_strategy'),
      status: this.getCapabilityValue('battery_status'),
      price: this.getCapabilityValue('energy_price'),
      savingsToday: this.getCapabilityValue('battery_savings_today'),
      demo: this.getSetting('demo_mode') === true,
      threshold: this.plan.dischargeThreshold,
      slots: this.plan.slots.slice(0, 96).map((s) => ({
        start: s.start, price: Math.round(s.price * 1000) / 1000, action: s.action, solarW: s.solarW,
      })),
    };
  }

  // ---- control loop -------------------------------------------------------

  scheduleTick(delay) {
    if (this.stopped) return;
    if (this.tickTimer) this.homey.clearTimeout(this.tickTimer);
    this.tickTimer = this.homey.setTimeout(() => this.tick(), delay);
  }

  async tick() {
    // One control round at a time: a round can take seconds (HTTP timeouts); a second round started
    // meanwhile (e.g. by a strategy change) would send double commands and double-count energy.
    if (this.ticking) {
      this.tickRequested = true;
      return;
    }
    this.ticking = true;
    const cfg = this.cfg;
    try {
      const [bResult, pResult] = await Promise.allSettled([this.battery.read(), this.p1.read()]);
      if (bResult.status === 'rejected') throw bResult.reason; // cannot control without the battery

      const bat = bResult.value;
      if (bat.sn && !this.getStoreValue('sn')) await this.setStoreValue('sn', bat.sn);
      if (bat.soc !== null) this.lastSoc = bat.soc;

      const meter = pResult.status === 'fulfilled' ? pResult.value : null;
      if (meter) {
        this.p1Failures = 0;
      } else {
        this.p1Failures += 1;
        // no counter in the text: the logbook merges repeats into one line with a count
        this.error('P1 read failed:', pResult.reason.message);
      }

      this.updateMeters(bat.batteryPower, bat.soc);
      const updates = [
        bat.soc !== null ? this.setCapabilityValue('measure_battery', bat.soc) : null,
        // Homey convention for home batteries: positive = charging
        this.setCapabilityValue('measure_power', -bat.batteryPower),
      ];
      if (meter) {
        const surplus = this.surplus.add(SurplusTracker.compute(bat.batteryPower, meter.gridPower));
        updates.push(this.setCapabilityValue('measure_power.grid', meter.gridPower));
        updates.push(this.setCapabilityValue('measure_power.surplus', surplus));
      }
      await Promise.all(updates);
      if (meter) this.evaluateSurplusTriggers();

      const strategy = this.getCapabilityValue('battery_strategy');
      const slot = slotAt(this.plan.slots);
      const planAction = slot ? slot.action : null;
      const needsP1 = NEEDS_P1.has(strategy) && !(strategy === 'dynamic' && planAction === 'charge');

      let target;
      let reason;
      if (!meter && needsP1) {
        // Without a grid measurement the battery must not keep its last set-point
        if (this.p1Failures < P1_FAILURES_BEFORE_IDLE) return; // short hiccup: wait
        target = 0;
        reason = 'geen P1-meting';
      } else {
        ({ target, reason } = computeTarget({
          strategy,
          planAction,
          batteryPower: bat.batteryPower,
          gridPower: meter ? meter.gridPower : 0,
          soc: bat.soc,
          lastTarget: this.lastTarget || 0,
          cfg,
        }));
      }
      this.lastTarget = target;

      // Goal-driven charge/discharge: switch to the follow-up strategy once the goal is reached
      const followUp = goalFollowUp(strategy, bat.soc, cfg);
      if (followUp && followUp !== strategy) {
        this.log(`Goal reached (${bat.soc} %), switching to ${followUp}`);
        await this.setStrategy(followUp);
        return;
      }

      // Demo mode: calculate everything, but never write to the battery (it keeps its own program)
      const now = Date.now();
      if (!cfg.demo && !this.stopped && shouldSend(target, this.lastCommand, now, cfg)) {
        await this.battery.setPower(target);
        this.lastCommand = { target, time: now };
      }

      this.logDataLine({
        bat, meter, target, reason, strategy, cfg,
      });

      await Promise.all([
        this.setCapabilityValue('battery_status', this.statusText(target, reason, cfg.demo)),
        // same sign convention as measure_power: positive = charging
        this.setCapabilityValue('measure_power.setpoint', -target),
      ]);
      this.failures = 0;
      if (!this.getAvailable()) await this.setAvailable();
      const p1Down = !meter && this.p1Failures >= P1_FAILURES_BEFORE_IDLE;
      if (p1Down !== !!this.p1Warning) {
        this.p1Warning = p1Down;
        this.log(p1Down ? 'P1-meter niet bereikbaar: regeling op stand-by' : 'P1-meter weer bereikbaar: regeling hervat');
        if (p1Down) await this.setWarning('HomeWizard P1 niet bereikbaar – regeling staat op stand-by').catch(this.error);
        else await this.unsetWarning().catch(this.error);
      }
    } catch (err) {
      this.failures += 1;
      this.error('Tick failed:', err.message);
      if (this.failures === FAILURES_BEFORE_UNAVAILABLE) this.log('Batterij niet bereikbaar: apparaat onbeschikbaar');
      if (this.failures >= FAILURES_BEFORE_UNAVAILABLE) {
        await this.setUnavailable(err.message).catch(this.error);
      }
    } finally {
      this.ticking = false;
      // Back off on errors, but not during the first P1 failures: the stand-by fallback must come quickly
      const p1Backoff = this.p1Failures >= P1_FAILURES_BEFORE_IDLE ? this.p1Failures : 0;
      const failed = this.failures + p1Backoff;
      if (this.tickRequested) {
        this.tickRequested = false;
        this.scheduleTick(0);
      } else {
        this.scheduleTick(failed > 0 ? Math.min(60000, cfg.interval * (1 + Math.min(failed, 5))) : cfg.interval);
      }
    }
  }

  /**
   * Surplus triggers fire once, on the evaluation where "held above/below X W for Y min"
   * becomes true (edge), so a Flow does not run again every 30 s.
   */
  evaluateSurplusTriggers() {
    const now = Date.now();
    if (this.lastSurplusEval && now - this.lastSurplusEval < SURPLUS_EVAL_MS) return;
    const state = { now, prev: this.lastSurplusEval };
    this.lastSurplusEval = now;
    if (!state.prev) return;
    const tokens = { surplus: this.surplus.current() };
    this.homey.app.triggers.surplusAbove.trigger(this, tokens, state).catch(this.error);
    this.homey.app.triggers.surplusBelow.trigger(this, tokens, state).catch(this.error);
  }

  surplusCrossed({ power, minutes }, { now, prev }, above) {
    return this.surplus.held(power, minutes, above, now) && !this.surplus.held(power, minutes, above, prev);
  }

  statusText(target, reason, demo = false) {
    let what = 'Stand-by';
    if (target > 0) what = `Ontladen ${target} W`;
    if (target < 0) what = `Laden ${-target} W`;
    if (demo) return `Demo – zou: ${what.toLowerCase()} · ${reason}`;
    return `${what} · ${reason}`;
  }

  async setDemoMode(enabled) {
    await this.setSettings({ demo_mode: enabled });
    await this.onDemoChanged(enabled);
  }

  async onDemoChanged(enabled) {
    this.log('Demo mode ->', enabled);
    this.lastCommand = null;
    // back to demo: hand the battery back to its own program
    if (enabled && this.battery) await this.battery.release().catch(this.error);
    this.homey.app.triggers.demoChanged.trigger(this, { demo: enabled }).catch(this.error);
    this.scheduleTick(200);
  }

  // ---- meters, savings and learned efficiency ------------------------------

  updateMeters(batteryPower, soc) {
    const now = Date.now();
    this.rollDay(soc);
    if (this.lastTick) {
      const hours = (now - this.lastTick) / 3600000;
      if (hours > 0 && hours < 0.1 && batteryPower !== 0) {
        const kwh = (Math.abs(batteryPower) * hours) / 1000;
        const cap = batteryPower < 0 ? 'meter_power.charged' : 'meter_power.discharged';
        const value = (this.getCapabilityValue(cap) || 0) + kwh;
        this.setCapabilityValue(cap, Math.round(value * 10000) / 10000).catch(this.error);

        const delta = savingsDelta(batteryPower, hours, this.currentPrice);
        if (delta !== 0) {
          this.savingsToday = (this.savingsToday ?? this.getCapabilityValue('battery_savings_today') ?? 0) + delta;
          this.savingsTotal = (this.savingsTotal ?? this.getCapabilityValue('battery_savings_total') ?? 0) + delta;
          this.setCapabilityValue('battery_savings_today', Math.round(this.savingsToday * 100) / 100).catch(this.error);
          this.setCapabilityValue('battery_savings_total', Math.round(this.savingsTotal * 100) / 100).catch(this.error);
        }
      }
    }
    this.lastTick = now;
  }

  /** At local midnight: reset today's savings and store a snapshot for efficiency learning. */
  rollDay(soc) {
    const today = this.homey.app.prices.formatDate(new Date());
    const stored = this.getStoreValue('day');
    if (stored === today) return;
    this.setStoreValue('day', today).catch(this.error);
    if (!stored) return; // first run: nothing to close

    this.savingsToday = 0;
    this.setCapabilityValue('battery_savings_today', 0).catch(this.error);

    const snapshots = this.getStoreValue('snapshots') || [];
    snapshots.push({
      date: today,
      charged: this.getCapabilityValue('meter_power.charged') || 0,
      discharged: this.getCapabilityValue('meter_power.discharged') || 0,
      soc,
    });
    const recent = snapshots.slice(-30);
    this.setStoreValue('snapshots', recent).catch(this.error);
    const eff = learnedEfficiency(recent, this.getSetting('capacity_kwh'));
    if (eff) {
      this.setCapabilityValue('battery_efficiency', Math.round(eff * 1000) / 10).catch(this.error);
      this.log(`Learned efficiency: ${(eff * 100).toFixed(1)} %`);
    }
  }

  // ---- lifecycle ----------------------------------------------------------

  async onSettings({ newSettings, changedKeys }) {
    BatteryDevice.validateSettings(newSettings);
    // Homey stores the new values after this handler returns
    this.homey.setTimeout(() => this.afterSettingsChanged(changedKeys, newSettings), 0);
  }

  static validateSettings(s) {
    if (s.min_soc >= s.max_soc) {
      throw new Error('Het minimale laadniveau moet lager zijn dan het maximale laadniveau.');
    }
    if (s.force_charge_w > s.max_charge_w) {
      throw new Error('Het vermogen voor geforceerd laden is hoger dan het maximale laadvermogen.');
    }
    if (s.force_discharge_w > s.max_discharge_w) {
      throw new Error('Het vermogen voor geforceerd ontladen is hoger dan het maximale ontlaadvermogen.');
    }
    const ipRe = /^\d{1,3}(\.\d{1,3}){3}$/;
    if (!ipRe.test(s.battery_ip) || !ipRe.test(s.p1_ip)) {
      throw new Error('Vul geldige IP-adressen in (bijv. 192.168.1.50).');
    }
    if (s.charge_goal_soc > s.max_soc) {
      throw new Error('Het laaddoel kan niet hoger zijn dan het maximale laadniveau.');
    }
    if (s.discharge_goal_soc < s.min_soc) {
      throw new Error('Het ontlaaddoel kan niet lager zijn dan het minimale laadniveau.');
    }
    if (s.web_pin && !/^\d{4,8}$/.test(s.web_pin)) {
      throw new Error('De pincode voor de webpagina moet uit 4 tot 8 cijfers bestaan.');
    }
  }

  afterSettingsChanged(changedKeys, newSettings) {
    this.lastCommand = null;
    if (changedKeys.some((k) => ['battery_ip', 'p1_ip', 'p1_token'].includes(k) || k.startsWith('modbus_')
      || k.startsWith('marstek_') || k === 'invert_power')) this.createClients();
    if (changedKeys.includes('entsoe_token')) {
      this.homey.app.prices.setEntsoeToken(this.getSetting('entsoe_token'));
      this.homey.app.prices.refresh().catch(this.error);
    }
    if (changedKeys.some((k) => k.startsWith('pv_') || k === 'forecast_enabled')) this.refreshForecast();
    if (changedKeys.includes('demo_mode')) this.onDemoChanged(newSettings.demo_mode);
    if (changedKeys.some((k) => k.startsWith('web_'))) this.homey.app.updateWebServer();
    this.updatePlan();
  }

  /**
   * Change settings from outside Homey's settings screen (the web page). Only known keys with the
   * right type are accepted; the same validation and follow-up as in the Homey app apply.
   */
  async applySettings(changes) {
    const schema = new Map(this.homey.app.settingsSchema(this.driver.id).map((f) => [f.id, f]));
    const clean = {};
    for (const [key, raw] of Object.entries(changes || {})) {
      const field = schema.get(key);
      if (!field) throw new Error(`Onbekende instelling: ${key}`);
      let value = raw;
      if (field.type === 'number') {
        value = Number(raw);
        if (!Number.isFinite(value)) throw new Error(`${field.label}: geen getal`);
        if (field.min !== undefined && value < field.min) throw new Error(`${field.label}: minimaal ${field.min}`);
        if (field.max !== undefined && value > field.max) throw new Error(`${field.label}: maximaal ${field.max}`);
      } else if (field.type === 'checkbox') {
        value = raw === true || raw === 'true';
      } else if (field.type === 'dropdown') {
        value = String(raw);
        if (!field.values.some((v) => v.id === value)) throw new Error(`${field.label}: ongeldige keuze`);
      } else {
        value = String(raw ?? '').trim();
        // secrets: an empty field means "keep the current value"
        if (field.type === 'password' && value === '') continue;
      }
      if (value !== this.getSetting(key)) clean[key] = value;
    }
    const changedKeys = Object.keys(clean);
    if (!changedKeys.length) return [];
    const newSettings = { ...this.getSettings(), ...clean };
    BatteryDevice.validateSettings(newSettings);
    await this.setSettings(clean);
    this.afterSettingsChanged(changedKeys, newSettings);
    this.log('Settings changed via web page:', changedKeys.join(', '));
    return changedKeys;
  }

  /** Everything the web page shows for this device. */
  getWebData() {
    const cap = (id) => (this.hasCapability(id) ? this.getCapabilityValue(id) : null);
    return {
      ...this.getWidgetData(),
      id: this.getData().id,
      available: this.getAvailable(),
      warning: this.p1Warning ? 'HomeWizard P1 niet bereikbaar – regeling staat op stand-by' : null,
      values: {
        grid: cap('measure_power.grid'),
        setpoint: cap('measure_power.setpoint'),
        surplus: cap('measure_power.surplus'),
        plan: cap('battery_plan'),
        charged: cap('meter_power.charged'),
        discharged: cap('meter_power.discharged'),
        savingsTotal: cap('battery_savings_total'),
        efficiency: cap('battery_efficiency'),
        forecastToday: cap('solar_forecast_today'),
      },
    };
  }

  async onDeleted() {
    this.cleanup();
    // hand the battery back to its own program (in demo mode it never left it)
    if (!this.getSetting('demo_mode')) await this.battery.release().catch(this.error);
    this.battery.close();
    this.homey.setTimeout(() => this.homey.app.updateWebServer(), 1000);
  }

  async onUninit() {
    this.cleanup();
    // best effort: hand the battery back to its own program when the app stops (not in demo mode)
    if (!this.getSetting('demo_mode')) await this.battery.release().catch(this.error);
    this.battery.close();
  }

  cleanup() {
    this.stopped = true; // an in-flight round must not schedule a new one or send commands
    if (this.tickTimer) this.homey.clearTimeout(this.tickTimer);
    if (this.planTimer) this.homey.clearInterval(this.planTimer);
    if (this.forecastTimer) this.homey.clearInterval(this.forecastTimer);
    if (this.unsubscribePrices) this.unsubscribePrices();
  }

}

module.exports = BatteryDevice;
