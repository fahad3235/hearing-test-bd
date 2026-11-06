/* Hearing Test BD -- pure logic (no DOM). Testable in Node.
 *
 * Honesty model: this app has NO calibrated hardware, so it CANNOT measure
 * clinical dB HL. The test works in RELATIVE levels 0..10 (each step is
 * ~10 dB of gain relative to the device volume set during calibration).
 * A threshold is the lowest relative level at which the tone is heard.
 * Results describe the SHAPE of hearing (which frequencies need louder
 * levels, left vs right) -- never a clinical diagnosis or dB HL value.
 */
(function (root) {
  'use strict';

  var FREQUENCIES = [500, 1000, 2000, 4000]; // Hz, screening set
  var MAX_LEVEL = 10;   // loudest relative level
  var MIN_LEVEL = 0;    // quietest relative level
  var START_LEVEL = 8;  // first presentation (clearly audible for most)
  var MAX_PRESENTATIONS = 12; // safety cap per frequency/ear

  // Relative gain for a level: level 10 -> 0.5, level 0 -> ~0.0016.
  // Each step is 5 dB of amplitude (20*log10 of the per-step ratio);
  // the full 0..10 range spans 50 dB. These are RELATIVE steps tied to
  // the device volume set during calibration, not clinical dB HL.
  function gainForLevel(level) {
    return 0.5 * Math.pow(10, (level - MAX_LEVEL) / 4);
  }

  // --- Staircase (simplified Hughson-Westlake) -------------------------
  // heard  -> go 2 levels quieter; not heard -> go 1 level louder.
  // Threshold is confirmed when the same level is heard twice, or when
  // level 0 is heard (cannot go quieter). No response at the loudest
  // level twice -> threshold null. Hard cap of 12 presentations.
  function createStaircase(freq, ear) {
    return {
      freq: freq, ear: ear, level: START_LEVEL, presentations: 0,
      heardCounts: {}, missCounts: {}, done: false, threshold: undefined
    };
  }

  function recordResponse(st, heard) {
    if (!st || st.done) return st;
    var L = st.level;
    st.presentations++;
    if (heard) {
      st.heardCounts[L] = (st.heardCounts[L] || 0) + 1;
      if (st.heardCounts[L] >= 2 || L === MIN_LEVEL) {
        st.done = true; st.threshold = L; return st;
      }
      st.level = Math.max(MIN_LEVEL, L - 2);
    } else {
      st.missCounts[L] = (st.missCounts[L] || 0) + 1;
      if (L === MAX_LEVEL && st.missCounts[L] >= 2) {
        st.done = true; st.threshold = null; return st;
      }
      st.level = Math.min(MAX_LEVEL, L + 1);
    }
    if (st.presentations >= MAX_PRESENTATIONS) {
      st.done = true;
      var heardLevels = Object.keys(st.heardCounts).map(Number);
      st.threshold = heardLevels.length ? Math.min.apply(null, heardLevels) : null;
    }
    return st;
  }

  // Simulate a consistent responder whose true threshold is T
  // (hears every level >= T, misses every level < T; T null = never hears).
  // Used by tests; also useful for the smoke harness.
  function simulateStaircase(freq, ear, trueThreshold) {
    var st = createStaircase(freq, ear);
    while (!st.done) {
      var heard = trueThreshold !== null && st.level >= trueThreshold;
      recordResponse(st, heard);
    }
    return st;
  }

  // --- Result summary ---------------------------------------------------
  // thresholds: { left: {500: 4, 1000: 4, ...}, right: {...} }
  // values 0..10 or null (no response at loudest level).
  function summarize(thresholds) {
    var perEar = {};
    ['left', 'right'].forEach(function (ear) {
      var t = thresholds[ear] || {};
      var vals = FREQUENCIES.map(function (f) { return t[f]; })
        .filter(function (v) { return v !== null && v !== undefined; });
      var noResponse = FREQUENCIES.filter(function (f) {
        return t[f] === null || t[f] === undefined;
      }).length;
      perEar[ear] = {
        avg: vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : null,
        worst: vals.length ? Math.max.apply(null, vals) : null,
        best: vals.length ? Math.min.apply(null, vals) : null,
        noResponse: noResponse,
        complete: vals.length === FREQUENCIES.length
      };
    });
    var maxDiff = 0, maxDiffFreq = null;
    FREQUENCIES.forEach(function (f) {
      var l = thresholds.left && thresholds.left[f];
      var r = thresholds.right && thresholds.right[f];
      if (l !== null && r !== null && l !== undefined && r !== undefined) {
        var d = Math.abs(l - r);
        if (d > maxDiff) { maxDiff = d; maxDiffFreq = f; }
      }
    });
    var flags = [];
    if (perEar.left.noResponse > 0 || perEar.right.noResponse > 0) flags.push('no-response');
    if (maxDiff >= 3) flags.push('asymmetric');
    if ((perEar.left.avg !== null && perEar.left.avg >= 8) ||
        (perEar.right.avg !== null && perEar.right.avg >= 8)) flags.push('high-levels');
    return { perEar: perEar, maxDiff: maxDiff, maxDiffFreq: maxDiffFreq, flags: flags };
  }

  // Plain-language verdict key for one ear (rendered by the app in EN/BN).
  // Never claims a clinical category: only describes relative levels.
  function earVerdict(earSummary) {
    if (!earSummary.complete) return 'incomplete';
    if (earSummary.noResponse > 0) return 'no-response';
    if (earSummary.avg >= 8) return 'high-levels';
    if (earSummary.worst >= 8) return 'one-high';
    if (earSummary.avg <= 3) return 'low-levels';
    return 'mid-levels';
  }

  // --- Validation -------------------------------------------------------
  function isPlainObject(x) {
    return x !== null && typeof x === 'object' && !Array.isArray(x);
  }

  function validThresholds(t) {
    if (!isPlainObject(t)) return false;
    return ['left', 'right'].every(function (ear) {
      if (!isPlainObject(t[ear])) return false;
      return FREQUENCIES.every(function (f) {
        var v = t[ear][f];
        return v === null || (Number.isInteger(v) && v >= MIN_LEVEL && v <= MAX_LEVEL);
      });
    });
  }

  function validResult(r) {
    if (!isPlainObject(r)) return false;
    if (typeof r.id !== 'string' || r.id.length === 0 || r.id.length > 64) return false;
    if (typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(r.date)) return false;
    if (!validThresholds(r.thresholds)) return false;
    if (r.note !== undefined && typeof r.note !== 'string') return false;
    if (typeof r.note === 'string' && r.note.length > 500) return false;
    return true;
  }

  function validateImport(obj) {
    if (!isPlainObject(obj)) return { ok: false, error: 'not-an-object' };
    if (obj.app !== 'hearing-test-bd') return { ok: false, error: 'wrong-app' };
    if (obj.version !== 1) return { ok: false, error: 'wrong-version' };
    if (!Array.isArray(obj.results)) return { ok: false, error: 'results-not-array' };
    if (obj.results.length > 200) return { ok: false, error: 'too-many-results' };
    var ids = {};
    for (var i = 0; i < obj.results.length; i++) {
      if (!validResult(obj.results[i])) return { ok: false, error: 'bad-result-' + i };
      if (ids[obj.results[i].id]) return { ok: false, error: 'duplicate-id' };
      ids[obj.results[i].id] = true;
    }
    return { ok: true };
  }

  function newResultId() {
    return 'ht-' + Date.now().toString(36) + '-' +
      Math.floor(Math.random() * 1296).toString(36);
  }

  var api = {
    FREQUENCIES: FREQUENCIES, MAX_LEVEL: MAX_LEVEL, MIN_LEVEL: MIN_LEVEL,
    START_LEVEL: START_LEVEL, MAX_PRESENTATIONS: MAX_PRESENTATIONS,
    gainForLevel: gainForLevel, createStaircase: createStaircase,
    recordResponse: recordResponse, simulateStaircase: simulateStaircase,
    summarize: summarize, earVerdict: earVerdict,
    validThresholds: validThresholds, validResult: validResult,
    validateImport: validateImport, newResultId: newResultId
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.HearingLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
