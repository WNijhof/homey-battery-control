'use strict';

const { requestJson } = require('./http');

const API = 'https://api.forecast.solar/estimate/watts';

/** Offset (ms) of a time zone at a given UTC instant. */
function tzOffset(utcMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** "2026-09-23 12:00:00" in time zone -> UTC ms */
function localToUtc(str, timeZone) {
  const [d, t] = str.split(' ');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi, se] = t.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, da, h, mi, se);
  let utc = guess - tzOffset(guess, timeZone);
  utc = guess - tzOffset(utc, timeZone); // correct around DST changes
  return utc;
}

/**
 * Solar production forecast from forecast.solar (free, no account, max 12 calls/hour).
 * Azimuth: 0 = south, -90 = east, 90 = west. Tilt: 0 = flat, 90 = vertical.
 */
class SolarForecast {

  constructor({ timezone = 'Europe/Amsterdam', log = () => {} } = {}) {
    this.timezone = timezone;
    this.log = log;
    this.points = []; // [{ t, w }] sorted
    this.fetchedAt = 0;
  }

  async refresh({ lat, lon, tilt, azimuth, kwp }) {
    const url = `${API}/${lat.toFixed(4)}/${lon.toFixed(4)}/${tilt}/${azimuth}/${kwp}`;
    const json = await requestJson(url, { timeout: 15000 });
    this.setWatts(json.result || {});
    this.fetchedAt = Date.now();
    this.log(`Solar forecast: ${this.points.length} points, today ${this.energyToday().toFixed(1)} kWh`);
  }

  setWatts(watts) {
    this.points = Object.entries(watts)
      .map(([k, w]) => ({ t: localToUtc(k, this.timezone), w: Number(w) }))
      .sort((a, b) => a.t - b.t);
  }

  /** Forecast power (W) at a moment, linearly interpolated; 0 outside known points. */
  wattsAt(t) {
    const p = this.points;
    if (!p.length || t <= p[0].t || t >= p[p.length - 1].t) return 0;
    // forecast.solar has a 0-point at sunset and sunrise, so the night interpolates to 0
    const i = p.findIndex((x) => x.t > t);
    const a = p[i - 1];
    const b = p[i];
    return a.w + ((b.w - a.w) * (t - a.t)) / (b.t - a.t);
  }

  /** Average forecast power over a slot. */
  averageWatts(start, end) {
    const steps = 3;
    let sum = 0;
    for (let k = 0; k < steps; k++) sum += this.wattsAt(start + ((k + 0.5) * (end - start)) / steps);
    return sum / steps;
  }

  energyToday(now = Date.now()) {
    const dayStart = now - ((now + tzOffset(now, this.timezone)) % 86400000);
    let kwh = 0;
    for (let t = dayStart; t < dayStart + 86400000; t += 900000) kwh += this.averageWatts(t, t + 900000) / 4000;
    return kwh;
  }

  hasData() {
    return this.points.length > 0;
  }

}

module.exports = { SolarForecast, localToUtc, tzOffset };
