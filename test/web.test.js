'use strict';

// node test/web.test.js  — web page server: status, settings, PIN protection, local-only
const assert = require('assert');
const http = require('http');
const { WebServer, isLocalAddress, isAllowedHost } = require('../lib/webserver');

function fakeDevice(settings) {
  return {
    settings,
    applied: [],
    strategy: 'dynamic',
    getData: () => ({ id: 'SN1' }),
    getSettings() { return this.settings; },
    getSetting(k) { return this.settings[k]; },
    async applySettings(changes) { this.applied.push(changes); Object.assign(this.settings, changes); return Object.keys(changes); },
    async setStrategy(s) { this.strategy = s; },
    getWebData() { return { id: 'SN1', name: 'Test', soc: 55, demo: true, slots: [], values: {} }; },
  };
}

function request(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1', port, method, path, headers: payload ? { 'Content-Type': 'application/json' } : {},
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body: data }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  assert(isLocalAddress('192.168.1.20') && isLocalAddress('::ffff:10.0.0.5') && isLocalAddress('172.20.1.1'));
  assert(!isLocalAddress('8.8.8.8') && !isLocalAddress('172.32.0.1') && !isLocalAddress('::ffff:84.1.2.3'));
  assert(isAllowedHost('192.168.1.10:8480') && isAllowedHost('homey-abc.local:8480') && isAllowedHost('localhost'));
  assert(!isAllowedHost('evil.example.com:8480') && !isAllowedHost(''), 'DNS rebinding host refused');

  const device = fakeDevice({ web_pin: '', p1_token: 'SECRET', max_charge_w: 800 });
  const schema = [
    { id: 'max_charge_w', type: 'number', label: 'Max laadvermogen', group: 'Batterij' },
    { id: 'p1_token', type: 'password', label: 'Token', group: 'Verbinding' },
    { id: 'web_pin', type: 'password', label: 'Pincode', group: 'Webpagina' },
  ];
  const server = new WebServer({
    page: '<html>ok</html>',
    getDevices: () => [device],
    getSchema: () => schema,
    getDiagnostics: () => '=== diagnose ===\nregel',
    getRecentLog: (limit) => [{ level: 'info', source: 'app', message: `limit ${limit}` }],
  });
  await server.start(0);
  const { port } = server.server.address();

  let r = await request(port, 'GET', '/');
  assert.strictEqual(r.status, 200);
  assert(/text\/html/.test(r.type));

  r = await request(port, 'GET', '/api/status');
  assert.strictEqual(JSON.parse(r.body).devices[0].soc, 55);

  r = await request(port, 'GET', '/api/settings');
  const settings = JSON.parse(r.body);
  assert(!r.body.includes('SECRET'), 'token is never sent to the page');
  assert.strictEqual(settings.fields.find((f) => f.id === 'p1_token').isSet, true);
  assert.strictEqual(settings.pinSet, false);

  r = await request(port, 'POST', '/api/settings', { pin: '1234', settings: { max_charge_w: 1000 } });
  assert.strictEqual(r.status, 403, 'no PIN configured: read only');
  assert.deepStrictEqual(device.applied, []);

  device.settings.web_pin = '4321';
  for (let i = 0; i < 5; i++) {
    r = await request(port, 'POST', '/api/settings', { pin: '0000', settings: { max_charge_w: 1000 } });
    assert.strictEqual(r.status, 403);
  }
  r = await request(port, 'POST', '/api/settings', { pin: '4321', settings: { max_charge_w: 1000 } });
  assert.strictEqual(r.status, 403, 'locked out after 5 wrong PINs');
  assert(/Te veel foute pogingen/.test(JSON.parse(r.body).error));

  server.attempts.clear();
  r = await request(port, 'POST', '/api/settings', { pin: '4321', settings: { max_charge_w: 1000 } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(device.settings.max_charge_w, 1000);

  r = await request(port, 'POST', '/api/strategy', { pin: '4321', strategy: 'hack' });
  assert.strictEqual(r.status, 400, 'unknown strategy refused');
  r = await request(port, 'POST', '/api/strategy', { pin: '4321', strategy: 'self_consumption' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(device.strategy, 'self_consumption');

  r = await request(port, 'GET', '/api/log?limit=50');
  assert.strictEqual(JSON.parse(r.body).lines[0].message, 'limit 50', 'log lines');
  r = await request(port, 'GET', '/api/diagnostics');
  assert(/text\/plain/.test(r.type) && r.body.startsWith('=== diagnose'), 'diagnostics file');

  r = await request(port, 'GET', '/nope');
  assert.strictEqual(r.status, 404);

  await server.stop();
  console.log('web tests ok');
})().catch((err) => { console.error(err); process.exit(1); });
