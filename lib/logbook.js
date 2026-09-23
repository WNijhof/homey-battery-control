'use strict';

const MAX_LINES = 3000; // about 2–3 days with a data line per minute
const PERSIST_LINES = 1500; // kept across app restarts
const REPEAT_WINDOW_MS = 5 * 60 * 1000;

/**
 * In-memory log of important events and one data line per minute, so a problem can be
 * reconstructed afterwards. Downloadable as one text file via the web page.
 */
class Logbook {

  constructor({ timezone = 'Europe/Amsterdam', load = () => [], save = () => {} } = {}) {
    this.timezone = timezone;
    this.save = save;
    this.lines = Array.isArray(load()) ? load() : [];
    this.dirty = false;
  }

  /**
   * @param {'info'|'warn'|'error'|'data'} level
   * @param {string} source   e.g. the device name or "app"
   * @param {...any} parts    message parts (Errors are reduced to their message)
   */
  add(level, source, ...parts) {
    const message = parts.map((p) => {
      if (p instanceof Error) return p.message;
      if (typeof p === 'object' && p !== null) {
        try { return JSON.stringify(p); } catch (err) { return String(p); }
      }
      return String(p);
    }).join(' ').slice(0, 1000);
    const now = Date.now();
    // a repeating problem (e.g. P1 offline every 5 s) becomes one line with a counter
    const last = this.lines[this.lines.length - 1];
    if (last && level !== 'data' && last.level === level && last.source === source
      && last.message === message && now - (last.last || last.t) < REPEAT_WINDOW_MS) {
      last.repeat = (last.repeat || 1) + 1;
      last.last = now;
      this.dirty = true;
      return;
    }
    this.lines.push({
      t: now, level, source, message,
    });
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES);
    this.dirty = true;
  }

  persist() {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      this.save(this.lines.slice(-PERSIST_LINES));
    } catch (err) {
      // storage full or unavailable: the in-memory log keeps working
    }
  }

  formatTime(t) {
    return new Intl.DateTimeFormat('nl-NL', {
      timeZone: this.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).format(new Date(t));
  }

  /** Last lines as text, newest last. */
  toText({ limit = MAX_LINES, level = null } = {}) {
    const lines = level ? this.lines.filter((l) => l.level === level) : this.lines;
    return lines.slice(-limit).map((l) => `${this.formatTime(l.t)}  ${l.level.toUpperCase().padEnd(5)} `
      + `[${l.source}] ${l.message}`
      + `${l.repeat ? ` (${l.repeat}× tot ${this.formatTime(l.last).slice(-8)})` : ''}`).join('\n');
  }

  recent(limit = 100) {
    return this.lines.slice(-limit).map((l) => ({ ...l, time: this.formatTime(l.t) }));
  }

}

/** Settings without secrets, for the diagnostics header. */
function maskSettings(settings, schema = []) {
  const secret = new Set(schema.filter((f) => f.type === 'password').map((f) => f.id));
  ['p1_token', 'entsoe_token', 'web_pin'].forEach((k) => secret.add(k));
  const out = {};
  for (const [k, v] of Object.entries(settings || {})) {
    out[k] = secret.has(k) ? (v ? '(ingesteld)' : '(leeg)') : v;
  }
  return out;
}

module.exports = { Logbook, maskSettings };
