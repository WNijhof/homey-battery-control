'use strict';

const http = require('http');
const crypto = require('crypto');
const { STRATEGIES } = require('./controller');

const MAX_BODY = 16 * 1024;
const MAX_PIN_ATTEMPTS = 5;
const LOCKOUT_MS = 10 * 60 * 1000;

/** Only answer requests from the home network (private address ranges and loopback). */
function isLocalAddress(address) {
  const ip = String(address || '').replace(/^::ffff:/, '');
  if (ip === '::1' || ip === '127.0.0.1') return true;
  if (/^fe80:|^fc|^fd/i.test(ip)) return true; // IPv6 link-local / unique local
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p))) return false;
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 127
    || (a === 169 && b === 254);
}

/**
 * Protection against DNS rebinding: a foreign website that makes its domain name point to the
 * Homey must not be able to read the page. Only IP addresses, localhost and *.local names are served.
 */
function isAllowedHost(hostHeader) {
  const host = String(hostHeader || '').replace(/:\d+$/, '').toLowerCase();
  if (!host) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (/^\[[0-9a-f:.]+\]$/.test(host)) return true;
  return host === 'localhost' || host.endsWith('.local');
}

function pinMatches(given, expected) {
  if (!expected) return false;
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Small local web server for the status/settings page.
 *   GET  /                 the page
 *   GET  /api/status       live data of all batteries
 *   GET  /api/settings     settings schema + values (secrets masked)
 *   POST /api/settings     { device, pin, settings }   change settings (PIN required)
 *   POST /api/strategy     { device, pin, strategy }   change strategy (PIN required)
 */
class WebServer {

  constructor({ page, getDevices, getSchema, log = () => {}, error = () => {} }) {
    this.page = page;
    this.getDevices = getDevices;
    this.getSchema = getSchema;
    this.log = log;
    this.error = error;
    this.server = null;
    this.port = null;
    this.attempts = new Map(); // ip -> { count, until }
  }

  async start(port) {
    if (this.server && this.port === port) return;
    await this.stop();
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        this.error('Web request failed:', err.message);
        this.send(res, 500, { error: err.message });
      });
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, () => {
        this.server.off('error', reject);
        resolve();
      });
    });
    this.port = port;
    this.log(`Web page listening on port ${port}`);
  }

  async stop() {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    this.port = null;
    await new Promise((resolve) => server.close(() => resolve()));
  }

  send(res, status, body, type = 'application/json; charset=utf-8') {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
    });
    res.end(payload);
  }

  readBody(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
        if (data.length > MAX_BODY) {
          reject(new Error('Request te groot'));
          req.destroy();
        }
      });
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (err) {
          reject(new Error('Ongeldige JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  findDevice(id) {
    const devices = this.getDevices();
    return (id ? devices.find((d) => d.getData().id === id) : devices[0]) || null;
  }

  checkPin(ip, device, pin) {
    const expected = device.getSetting('web_pin');
    if (!expected) {
      return 'Wijzigen is uitgeschakeld: stel eerst in Homey een pincode in (instellingen → Webpagina).';
    }
    const state = this.attempts.get(ip) || { count: 0, until: 0 };
    if (Date.now() < state.until) {
      return `Te veel foute pogingen. Probeer het over ${Math.ceil((state.until - Date.now()) / 60000)} min opnieuw.`;
    }
    if (!pinMatches(pin, expected)) {
      state.count += 1;
      if (state.count >= MAX_PIN_ATTEMPTS) {
        state.until = Date.now() + LOCKOUT_MS;
        state.count = 0;
      }
      this.attempts.set(ip, state);
      return 'Onjuiste pincode.';
    }
    this.attempts.delete(ip);
    return null;
  }

  async handle(req, res) {
    const ip = req.socket.remoteAddress;
    if (!isLocalAddress(ip)) {
      this.send(res, 403, { error: 'Alleen bereikbaar vanaf het thuisnetwerk' });
      return;
    }
    if (!isAllowedHost(req.headers.host)) {
      this.send(res, 403, { error: 'Open de pagina via het IP-adres of de .local-naam van je Homey' });
      return;
    }
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      this.send(res, 200, this.page, 'text/html; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      this.send(res, 200, { time: Date.now(), devices: this.getDevices().map((d) => d.getWebData()) });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/settings') {
      const device = this.findDevice(url.searchParams.get('device'));
      if (!device) { this.send(res, 404, { error: 'Geen batterij gekoppeld' }); return; }
      const values = device.getSettings();
      const fields = this.getSchema().map((f) => ({
        ...f,
        value: f.type === 'password' ? undefined : values[f.id],
        isSet: f.type === 'password' ? Boolean(values[f.id]) : undefined,
      }));
      this.send(res, 200, { device: device.getData().id, pinSet: Boolean(values.web_pin), fields });
      return;
    }
    if (req.method === 'POST' && (url.pathname === '/api/settings' || url.pathname === '/api/strategy')) {
      const body = await this.readBody(req);
      const device = this.findDevice(body.device);
      if (!device) { this.send(res, 404, { error: 'Geen batterij gekoppeld' }); return; }
      const pinError = this.checkPin(ip, device, body.pin);
      if (pinError) { this.send(res, 403, { error: pinError }); return; }
      try {
        if (url.pathname === '/api/strategy') {
          if (!STRATEGIES.includes(body.strategy)) throw new Error('Onbekende strategie');
          await device.setStrategy(body.strategy);
          this.send(res, 200, { ok: true });
        } else {
          const changed = await device.applySettings(body.settings);
          this.send(res, 200, { ok: true, changed });
        }
      } catch (err) {
        this.send(res, 400, { error: err.message });
      }
      return;
    }
    this.send(res, 404, { error: 'Niet gevonden' });
  }

}

module.exports = {
  WebServer, isLocalAddress, isAllowedHost, pinMatches,
};
