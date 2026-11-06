// Hearing Test BD -- node unit tests for js/hearing.js (pure logic).
// Run: node --test tests/logic.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/hearing.js');

test('gainForLevel: level 10 is loudest, each step is 5 dB amplitude', () => {
  assert.ok(L.gainForLevel(10) > L.gainForLevel(9));
  // per-step amplitude ratio is 10^(-5/20) = 10^(-0.25)
  assert.ok(Math.abs(L.gainForLevel(9) / L.gainForLevel(10) - 0.5623413251903491) < 1e-9);
  assert.equal(L.gainForLevel(10), 0.5);
  assert.ok(Math.abs(L.gainForLevel(0) - 0.0015811388300841898) < 1e-12);
  assert.ok(L.gainForLevel(0) < L.gainForLevel(5));
});

test('staircase: consistent responder threshold 4 recovers 4', () => {
  const st = L.simulateStaircase(1000, 'left', 4);
  assert.equal(st.threshold, 4);
  assert.ok(st.done);
  assert.ok(st.presentations <= 8, 'presentations=' + st.presentations);
});

test('staircase: threshold 0 recovers 0 (heard at quietest)', () => {
  const st = L.simulateStaircase(500, 'right', 0);
  assert.equal(st.threshold, 0);
});

test('staircase: threshold 10 recovers 10 (only hears loudest)', () => {
  const st = L.simulateStaircase(2000, 'left', 10);
  assert.equal(st.threshold, 10);
});

test('staircase: never hears -> threshold null (no response)', () => {
  const st = L.simulateStaircase(4000, 'right', null);
  assert.equal(st.threshold, null);
  assert.ok(st.presentations <= 6);
});

test('staircase: threshold 7 recovers 7', () => {
  assert.equal(L.simulateStaircase(1000, 'left', 7).threshold, 7);
  assert.equal(L.simulateStaircase(2000, 'right', 2).threshold, 2);
  assert.equal(L.simulateStaircase(500, 'left', 9).threshold, 9);
});

test('staircase: inconsistent responder still terminates within cap', () => {
  const st = L.createStaircase(1000, 'left');
  // Alternating answers: heard, missed, heard, missed...
  let heard = true;
  while (!st.done) {
    L.recordResponse(st, heard);
    heard = !heard;
  }
  assert.ok(st.presentations <= L.MAX_PRESENTATIONS);
  assert.ok(st.threshold === null || (st.threshold >= 0 && st.threshold <= 10));
});

test('staircase: recordResponse on a done staircase is a no-op', () => {
  const st = L.simulateStaircase(1000, 'left', 4);
  const before = st.presentations;
  L.recordResponse(st, true);
  assert.equal(st.presentations, before);
  assert.equal(st.threshold, 4);
});

test('summarize: normal profile has no flags', () => {
  const th = { left: { 500: 2, 1000: 2, 2000: 3, 4000: 3 }, right: { 500: 2, 1000: 3, 2000: 2, 4000: 3 } };
  const s = L.summarize(th);
  assert.deepEqual(s.flags, []);
  assert.equal(s.perEar.left.avg, 2.5);
  assert.equal(s.maxDiff, 1);
});

test('summarize: asymmetric ears flagged with the worst frequency', () => {
  const th = { left: { 500: 2, 1000: 2, 2000: 2, 4000: 2 }, right: { 500: 2, 1000: 2, 2000: 8, 4000: 2 } };
  const s = L.summarize(th);
  assert.ok(s.flags.includes('asymmetric'));
  assert.equal(s.maxDiff, 6);
  assert.equal(s.maxDiffFreq, 2000);
});

test('summarize: no response at loudest flagged', () => {
  const th = { left: { 500: 2, 1000: 2, 2000: 2, 4000: null }, right: { 500: 2, 1000: 2, 2000: 2, 4000: 2 } };
  const s = L.summarize(th);
  assert.ok(s.flags.includes('no-response'));
  assert.equal(s.perEar.left.noResponse, 1);
  assert.equal(s.perEar.left.avg, 2);
});

test('summarize: high average level flagged', () => {
  const th = { left: { 500: 8, 1000: 9, 2000: 8, 4000: 9 }, right: { 500: 2, 1000: 2, 2000: 2, 4000: 2 } };
  const s = L.summarize(th);
  assert.ok(s.flags.includes('high-levels'));
  assert.equal(s.perEar.left.avg, 8.5);
});

test('earVerdict: maps summaries to plain-language keys', () => {
  assert.equal(L.earVerdict({ complete: true, noResponse: 1, avg: 2, worst: 3 }), 'no-response');
  assert.equal(L.earVerdict({ complete: true, noResponse: 0, avg: 8.5, worst: 9 }), 'high-levels');
  assert.equal(L.earVerdict({ complete: true, noResponse: 0, avg: 4, worst: 8 }), 'one-high');
  assert.equal(L.earVerdict({ complete: true, noResponse: 0, avg: 2, worst: 3 }), 'low-levels');
  assert.equal(L.earVerdict({ complete: true, noResponse: 0, avg: 5, worst: 6 }), 'mid-levels');
  assert.equal(L.earVerdict({ complete: false, noResponse: 0, avg: null, worst: null }), 'incomplete');
});

test('validThresholds: accepts full 4x2 grid, rejects out-of-range and missing ears', () => {
  const ok = { left: { 500: 0, 1000: 10, 2000: null, 4000: 5 }, right: { 500: 1, 1000: 2, 2000: 3, 4000: 4 } };
  assert.equal(L.validThresholds(ok), true);
  assert.equal(L.validThresholds({ left: { 500: 0, 1000: 10, 2000: null, 4000: 5 } }), false);
  assert.equal(L.validThresholds({ left: { 500: 11, 1000: 10, 2000: 0, 4000: 5 }, right: ok.right }), false);
  assert.equal(L.validThresholds({ left: { 500: 0, 1000: 10, 2000: 0 }, right: ok.right }), false);
  assert.equal(L.validThresholds(null), false);
});

test('validateImport: accepts a well-formed export, rejects everything else', () => {
  const good = {
    app: 'hearing-test-bd', version: 1,
    results: [{ id: 'ht-abc', date: '2026-11-06T12:00:00.000Z',
      thresholds: { left: { 500: 2, 1000: 2, 2000: 3, 4000: 3 }, right: { 500: 2, 1000: 2, 2000: 2, 4000: 2 } },
      note: 'quiet room' }]
  };
  assert.deepEqual(L.validateImport(good), { ok: true });
  assert.equal(L.validateImport({ app: 'other-app', version: 1, results: [] }).ok, false);
  assert.equal(L.validateImport({ app: 'hearing-test-bd', version: 2, results: [] }).ok, false);
  assert.equal(L.validateImport({ app: 'hearing-test-bd', version: 1 }).ok, false);
  assert.equal(L.validateImport('not an object').ok, false);
  const badResult = JSON.parse(JSON.stringify(good));
  badResult.results[0].thresholds.left[500] = 99;
  assert.equal(L.validateImport(badResult).ok, false);
  const dup = JSON.parse(JSON.stringify(good));
  dup.results.push(JSON.parse(JSON.stringify(good.results[0])));
  assert.equal(L.validateImport(dup).ok, false);
  const badDate = JSON.parse(JSON.stringify(good));
  badDate.results[0].date = 'yesterday';
  assert.equal(L.validateImport(badDate).ok, false);
});

test('newResultId: unique, prefixed, string', () => {
  const a = L.newResultId();
  const b = L.newResultId();
  assert.ok(a.startsWith('ht-'));
  assert.notEqual(a, b);
});
