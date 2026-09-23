'use strict';

const http = require('http');
const https = require('https');

// Local devices (HomeWizard API v2) use self-signed certificates
const insecureAgent = new https.Agent({ rejectUnauthorized: false });

/**
 * Minimal request helper (no dependencies, works on every Homey firmware).
 * Resolves with parsed JSON, or with the raw text when `raw` is set.
 */
function request(url, {
  method = 'GET', body, timeout = 5000, headers = {}, insecure = false, raw = false,
} = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https:');
    const client = isHttps ? https : http;
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = client.request(url, {
      method,
      timeout,
      agent: isHttps && insecure ? insecureAgent : undefined,
      headers: {
        Accept: raw ? '*/*' : 'application/json',
        ...headers,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new Error(`HTTP ${res.statusCode} from ${url}: ${data.slice(0, 200)}`);
          err.statusCode = res.statusCode;
          reject(err);
          return;
        }
        if (raw) { resolve(data); return; }
        if (!data) { resolve({}); return; }
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error(`Invalid JSON from ${url}`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`Timeout for ${url}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function requestJson(url, options) {
  return request(url, options);
}

module.exports = { request, requestJson };
