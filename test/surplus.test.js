'use strict';

const assert = require('assert');
const SurplusTracker = require('../lib/surplus');

// definition
assert.strictEqual(SurplusTracker.compute(-1000, -300), 1300, 'charging 1000 + export 300');
assert.strictEqual(SurplusTracker.compute(-800, 500), 300, 'grid charging does not count');
assert.strictEqual(SurplusTracker.compute(400, 100), 0, 'discharging, importing');
assert.strictEqual(SurplusTracker.compute(0, -600), 600, 'export only');

// held above for 10 minutes, sampled every 5 s
const tr = new SurplusTracker();
const t0 = 1e12;
let crossedAt = null;
let prev = null;
for (let s = 0; s <= 30 * 60; s += 5) {
  const t = t0 + s * 1000;
  tr.add(s < 5 * 60 ? 100 : 900, t); // surplus rises to 900 W after 5 min
  if (s % 30 === 0) {
    if (prev !== null && crossedAt === null
      && tr.held(600, 10, true, t) && !tr.held(600, 10, true, prev)) crossedAt = s;
    prev = t;
  }
}
assert(crossedAt !== null, 'trigger fires');
assert(crossedAt >= 15 * 60 && crossedAt <= 16.5 * 60, `fires ~10 min after rise (at ${crossedAt / 60} min)`);
console.log(`surplus tests ok (trigger at ${crossedAt / 60} min)`);
