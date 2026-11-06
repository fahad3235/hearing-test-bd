/* Hearing Test BD -- UI + audio engine. Pure-ASCII sources (Bengali via i18n.js). */
(function () {
  'use strict';

  var L = window.HearingLogic;
  var LS_LANG = 'htbd-lang-v1';
  var LS_RESULTS = 'htbd-results-v1';
  var EARS = ['left', 'right'];
  var TOTAL_STEPS = EARS.length * L.FREQUENCIES.length; // 8 thresholds

  var state = {
    lang: 'en',
    results: [],
    setup: { calibrated: false, chanLeft: false, chanRight: false },
    pendingChan: null,
    test: {
      active: false, earIdx: 0, freqIdx: 0,
      staircase: null, thresholds: { left: {}, right: {} }, doneCount: 0
    },
    viewing: null // thresholds currently shown in the results card
  };

  // ---------- i18n ----------
  var BN_DIGITS = ['\u09e6', '\u09e7', '\u09e8', '\u09e9', '\u09ea',
                   '\u09eb', '\u09ec', '\u09ed', '\u09ee', '\u09ef'];
  function bnDigits(s) {
    return String(s).replace(/[0-9]/g, function (d) { return BN_DIGITS[+d]; });
  }
  function t(key, vars) {
    var entry = window.I18N[key];
    var s = entry ? (entry[state.lang] || entry.en) : key;
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        s = s.split('{' + k + '}').join(String(vars[k]));
      });
    }
    return state.lang === 'bn' ? bnDigits(s) : s;
  }
  function $(id) { return document.getElementById(id); }

  var STATIC_TEXT = {
    'app-title': 'appTitle', 'app-subtitle': 'appSubtitle',
    'tab-test-btn': 'tabTest', 'tab-history-btn': 'tabHistory', 'tab-data-btn': 'tabData',
    'setup-title': 'setupTitle', 'setup-1': 'setup1', 'setup-2': 'setup2', 'setup-3': 'setup3',
    'calib-title': 'calibTitle', 'calib-text': 'calibText',
    'play-calib-btn': 'playCalib', 'chan-title': 'chanTitle', 'chan-text': 'chanText',
    'play-left-btn': 'playLeft', 'play-right-btn': 'playRight',
    'heard-left-btn': 'heardLeft', 'heard-right-btn': 'heardRight', 'heard-both-btn': 'heardBoth',
    'start-test-btn': 'startTest', 'start-hint': 'startHint',
    'test-title': 'testTitle', 'heard-btn': 'heardIt', 'notheard-btn': 'notHeard',
    'replay-btn': 'replay', 'stop-test-btn': 'stopTest',
    'results-title': 'resultsTitle', 'results-sub': 'resultsSub',
    'note-label': 'notePh', 'save-result-btn': 'saveResult', 'retake-btn': 'retake',
    'hist-title': 'histTitle', 'data-title': 'dataTitle',
    'export-btn': 'exportBtn', 'import-title': 'importTitle', 'import-btn': 'importBtn',
    'erase-title': 'eraseTitle', 'erase-hint': 'eraseHint', 'erase-btn': 'eraseBtn',
    'footer-note': 'footerNote'
  };

  function applyLang() {
    Object.keys(STATIC_TEXT).forEach(function (id) {
      var el = $(id);
      if (el) el.textContent = t(STATIC_TEXT[id]);
    });
    $('lang-toggle').textContent = t('langToggle');
    document.documentElement.lang = state.lang === 'bn' ? 'bn' : 'en';
    renderHistory();
    if (state.viewing) renderResults(state.viewing);
    updateSetupUI();
  }

  function setLang(lang) {
    state.lang = lang;
    try { localStorage.setItem(LS_LANG, lang); } catch (e) {}
    applyLang();
  }

  // ---------- persistence ----------
  function loadPersisted() {
    try {
      var lang = localStorage.getItem(LS_LANG);
      if (lang === 'bn' || lang === 'en') state.lang = lang;
      var raw = localStorage.getItem(LS_RESULTS);
      if (raw) {
        var parsed = JSON.parse(raw);
        var check = L.validateImport({ app: 'hearing-test-bd', version: 1, results: parsed });
        if (check.ok) state.results = parsed;
      }
    } catch (e) { /* corrupted storage: start empty */ }
  }
  function persistResults() {
    try { localStorage.setItem(LS_RESULTS, JSON.stringify(state.results)); } catch (e) {}
  }

  // ---------- audio engine ----------
  var audioCtx = null, currentOsc = null;
  function ensureCtx() {
    try {
      if (!audioCtx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        audioCtx = new AC();
      }
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(function () {});
      return audioCtx;
    } catch (e) { return null; }
  }
  function stopTone() {
    if (!currentOsc) return;
    try { currentOsc.stop(); } catch (e) {}
    currentOsc = null;
  }
  // Play a sine tone. Returns false only if audio is unavailable; the
  // test flow never depends on the return value.
  function playTone(freq, level, pan) {
    stopTone();
    try {
      var ctx = ensureCtx();
      if (!ctx) return false;
      var osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      var gain = ctx.createGain();
      var g = Math.max(L.gainForLevel(level), 0.0002);
      var now = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(g, now + 0.05);
      gain.gain.setValueAtTime(g, now + 1.35);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
      try {
        var panner = ctx.createStereoPanner();
        panner.pan.value = pan;
        osc.connect(gain); gain.connect(panner); panner.connect(ctx.destination);
      } catch (e) {
        osc.connect(gain); gain.connect(ctx.destination);
      }
      osc.start(now);
      osc.stop(now + 1.55);
      currentOsc = osc;
      return true;
    } catch (e) { return false; }
  }

  // ---------- setup flow ----------
  function updateSetupUI() {
    $('calib-status').textContent = state.setup.calibrated ? t('calibDone') : '';
    var ready = state.setup.calibrated && state.setup.chanLeft && state.setup.chanRight;
    $('start-test-btn').disabled = !ready;
    $('start-hint').textContent = ready ? '' : t('startHint');
  }
  function playCalibration() {
    playTone(1000, 8, 0);
    state.setup.calibrated = true;
    updateSetupUI();
  }
  function playChannel(ear) {
    playTone(1000, 8, ear === 'left' ? -1 : 1);
    state.pendingChan = ear;
    $('chan-status').textContent = '';
    $('chan-status').classList.remove('error');
  }
  function answerChannel(heardEar) {
    var status = $('chan-status');
    if (!state.pendingChan) {
      status.textContent = t('chanPlayFirst');
      status.classList.add('error');
      return;
    }
    if (heardEar === state.pendingChan) {
      if (heardEar === 'left') {
        state.setup.chanLeft = true;
        status.textContent = t('chanLeftOk');
      } else {
        state.setup.chanRight = true;
        status.textContent = t('chanRightOk');
      }
      status.classList.remove('error');
      state.pendingChan = null;
      updateSetupUI();
    } else {
      status.textContent = t('chanWrong');
      status.classList.add('error');
      state.pendingChan = null;
    }
  }

  // ---------- test flow ----------
  function currentEar() { return EARS[state.test.earIdx]; }
  function showCard(id) {
    ['setup-card', 'test-card', 'results-card'].forEach(function (c) {
      $(c).classList.toggle('hidden', c !== id);
    });
  }
  function startTest() {
    var tst = state.test;
    tst.active = true;
    tst.earIdx = 0; tst.freqIdx = 0; tst.doneCount = 0;
    tst.thresholds = { left: {}, right: {} };
    tst.staircase = null;
    state.viewing = null;
    $('save-result-btn').disabled = false;
    $('saved-msg').textContent = '';
    $('result-note').value = '';
    showCard('test-card');
    presentStep();
  }
  function presentStep() {
    var tst = state.test;
    var ear = currentEar();
    var freq = L.FREQUENCIES[tst.freqIdx];
    tst.staircase = L.createStaircase(freq, ear);
    updateTestUI();
    playTone(freq, tst.staircase.level, ear === 'left' ? -1 : 1);
  }
  function updateTestUI() {
    var tst = state.test;
    var ear = currentEar();
    var freq = L.FREQUENCIES[tst.freqIdx];
    $('test-step').textContent = t('testStep', { a: tst.doneCount + 1, b: TOTAL_STEPS });
    $('test-progress').style.width = (tst.doneCount / TOTAL_STEPS * 100) + '%';
    $('test-ear-freq').textContent =
      (ear === 'left' ? t('earLeft') : t('earRight')) + ' - ' + t('freqLabel', { f: freq });
    $('test-status').textContent = t('listening');
  }
  function answerHeard(heard) {
    var tst = state.test;
    if (!tst.active || !tst.staircase) return;
    stopTone();
    L.recordResponse(tst.staircase, heard);
    if (tst.staircase.done) {
      tst.thresholds[currentEar()][tst.staircase.freq] = tst.staircase.threshold;
      tst.doneCount++;
      if (tst.doneCount >= TOTAL_STEPS) { finishTest(); return; }
      tst.freqIdx++;
      if (tst.freqIdx >= L.FREQUENCIES.length) { tst.freqIdx = 0; tst.earIdx++; }
      presentStep();
    } else {
      updateTestUI();
      playTone(tst.staircase.freq, tst.staircase.level, currentEar() === 'left' ? -1 : 1);
    }
  }
  function stopTest() {
    state.test.active = false;
    stopTone();
    showCard('setup-card');
  }
  function finishTest() {
    state.test.active = false;
    stopTone();
    state.viewing = state.test.thresholds;
    showCard('results-card');
    renderResults(state.viewing);
  }

  // ---------- audiogram ----------
  function yForLevel(level) {
    if (level === null || level === undefined) return 305;
    return 30 + level * 25;
  }
  function xForFreq(i) { return 70 + i * 140; }
  function audiogramSVG(thresholds) {
    var W = 560, H = 340;
    var s = '';
    s += '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="audiogram">';
    // gridlines + level labels
    for (var lv = 0; lv <= 10; lv++) {
      var y = yForLevel(lv);
      s += '<line x1="60" y1="' + y + '" x2="520" y2="' + y + '" stroke="#e3ebef" stroke-width="1"/>';
      s += '<text x="52" y="' + (y + 4) + '" font-size="12" fill="#5b6b7a" text-anchor="end">' +
        (state.lang === 'bn' ? bnDigits(lv) : lv) + '</text>';
    }
    s += '<text x="52" y="309" font-size="12" fill="#5b6b7a" text-anchor="end">NR</text>';
    s += '<line x1="60" y1="305" x2="520" y2="305" stroke="#e3ebef" stroke-width="1"/>';
    // frequency labels
    L.FREQUENCIES.forEach(function (f, i) {
      var x = xForFreq(i);
      s += '<text x="' + x + '" y="328" font-size="12" fill="#1c2733" text-anchor="middle">' +
        (state.lang === 'bn' ? bnDigits(f) : f) + ' Hz</text>';
    });
    s += '<text x="290" y="18" font-size="13" fill="#5b6b7a" text-anchor="middle">' +
      t('levelWord') + ' (0-10)</text>';
    // per-ear lines + markers
    var colors = { left: '#0e7c7b', right: '#1f6fb2' };
    ['left', 'right'].forEach(function (ear) {
      var pts = L.FREQUENCIES.map(function (f, i) {
        return [xForFreq(i), yForLevel(thresholds[ear][f])];
      });
      var path = pts.map(function (p, i) { return (i === 0 ? 'M' : 'L') + p[0] + ',' + p[1]; }).join(' ');
      s += '<path d="' + path + '" fill="none" stroke="' + colors[ear] + '" stroke-width="2.5"/>';
      pts.forEach(function (p, i) {
        var f = L.FREQUENCIES[i];
        var v = thresholds[ear][f];
        if (v === null || v === undefined) {
          s += '<text x="' + p[0] + '" y="' + (p[1] - 6) + '" font-size="13" font-weight="bold" fill="' +
            colors[ear] + '" text-anchor="middle">NR</text>';
        } else if (ear === 'left') {
          s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="7" fill="' + colors[ear] + '"/>';
        } else {
          s += '<rect x="' + (p[0] - 6) + '" y="' + (p[1] - 6) + '" width="12" height="12" fill="' + colors[ear] + '"/>';
        }
      });
    });
    s += '</svg>';
    s += '<div class="audiogram-legend"><span><span class="swatch" style="background:#0e7c7b"></span>' +
      t('earLeft') + '</span><span><span class="swatch" style="background:#1f6fb2"></span>' +
      t('earRight') + '</span></div>';
    return s;
  }

  // ---------- results ----------
  function fmtLevel(v) {
    if (v === null || v === undefined) return t('noResponse');
    return state.lang === 'bn' ? bnDigits(v) : String(v);
  }
  function renderResults(thresholds) {
    state.viewing = thresholds;
    $('audiogram').innerHTML = audiogramSVG(thresholds);
    var sum = L.summarize(thresholds);
    var verdictKey = {
      'low-levels': 'verdictLow', 'mid-levels': 'verdictMid',
      'one-high': 'verdictOneHigh', 'high-levels': 'verdictHigh',
      'no-response': 'verdictNoResp', 'incomplete': 'verdictMid'
    };
    var html = '';
    ['left', 'right'].forEach(function (ear) {
      var e = sum.perEar[ear];
      var avg = e.avg === null ? '--' : e.avg.toFixed(1);
      html += '<div class="summary-ear"><h4>' + (ear === 'left' ? t('earLeft') : t('earRight')) +
        ' - ' + t('avgWord') + ': ' + (state.lang === 'bn' ? bnDigits(avg) : avg) + '</h4><p>' +
        t(verdictKey[L.earVerdict(e)] || 'verdictMid') + '</p><p class="muted">' +
        L.FREQUENCIES.map(function (f) {
          return (state.lang === 'bn' ? bnDigits(f) : f) + ' Hz: ' + fmtLevel(thresholds[ear][f]);
        }).join(' | ') + '</p></div>';
    });
    $('results-summary').innerHTML = html;
    var flagsHtml = '';
    sum.flags.forEach(function (flag) {
      if (flag === 'no-response') flagsHtml += '<li>' + t('flagNoResp') + '</li>';
      if (flag === 'high-levels') flagsHtml += '<li>' + t('flagHigh') + '</li>';
      if (flag === 'asymmetric') flagsHtml += '<li>' + t('flagAsym', { f: sum.maxDiffFreq }) + '</li>';
    });
    $('results-flags').innerHTML = flagsHtml;
  }

  function saveResult() {
    if (!state.viewing) return;
    var note = $('result-note').value.trim();
    var result = {
      id: L.newResultId(),
      date: new Date().toISOString(),
      thresholds: JSON.parse(JSON.stringify(state.viewing)),
      note: note
    };
    if (!L.validResult(result)) return;
    state.results.unshift(result);
    persistResults();
    $('save-result-btn').disabled = true;
    $('saved-msg').textContent = t('savedMsg');
    renderHistory();
  }

  // ---------- history ----------
  function fmtDate(iso) {
    var d = new Date(iso);
    var s = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0') + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    return state.lang === 'bn' ? bnDigits(s) : s;
  }
  function renderHistory() {
    var list = $('history-list');
    var empty = $('hist-empty');
    empty.textContent = t('emptyHist');
    empty.classList.toggle('hidden', state.results.length > 0);
    list.innerHTML = '';
    state.results.forEach(function (r) {
      var sum = L.summarize(r.thresholds);
      var li = document.createElement('li');
      var meta = document.createElement('div');
      meta.className = 'hist-meta';
      var avgL = sum.perEar.left.avg === null ? '--' : sum.perEar.left.avg.toFixed(1);
      var avgR = sum.perEar.right.avg === null ? '--' : sum.perEar.right.avg.toFixed(1);
      var line = t('earLeft') + ' ' + (state.lang === 'bn' ? bnDigits(avgL) : avgL) +
        ' | ' + t('earRight') + ' ' + (state.lang === 'bn' ? bnDigits(avgR) : avgR);
      if (r.note) line += ' - ' + r.note;
      meta.innerHTML = '';
      var d1 = document.createElement('div');
      d1.className = 'hist-date';
      d1.textContent = fmtDate(r.date);
      var d2 = document.createElement('div');
      d2.textContent = line;
      meta.appendChild(d1);
      meta.appendChild(d2);
      var viewBtn = document.createElement('button');
      viewBtn.className = 'btn';
      viewBtn.type = 'button';
      viewBtn.textContent = t('viewBtn');
      viewBtn.addEventListener('click', function () {
        state.viewing = r.thresholds;
        $('save-result-btn').disabled = true;
        $('saved-msg').textContent = '';
        $('result-note').value = r.note || '';
        showCard('results-card');
        renderResults(r.thresholds);
        switchTab('test');
      });
      var delBtn = document.createElement('button');
      delBtn.className = 'btn';
      delBtn.type = 'button';
      delBtn.textContent = t('deleteBtn');
      delBtn.addEventListener('click', function () {
        if (delBtn.dataset.armed) {
          state.results = state.results.filter(function (x) { return x.id !== r.id; });
          persistResults();
          renderHistory();
        } else {
          delBtn.dataset.armed = '1';
          delBtn.textContent = t('confirmDelete');
          setTimeout(function () {
            delete delBtn.dataset.armed;
            delBtn.textContent = t('deleteBtn');
          }, 3000);
        }
      });
      li.appendChild(meta);
      li.appendChild(viewBtn);
      li.appendChild(delBtn);
      list.appendChild(li);
    });
  }

  // ---------- data ----------
  function exportJSON() {
    return JSON.stringify({ app: 'hearing-test-bd', version: 1, results: state.results }, null, 2);
  }
  function downloadExport() {
    var blob = new Blob([exportJSON()], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'hearing-test-bd-results.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function doImportFromText(text) {
    var status = $('import-status');
    var parsed;
    try { parsed = JSON.parse(text); } catch (e) {
      status.textContent = t('importErr', { e: 'bad-json' });
      status.classList.add('error');
      return false;
    }
    var check = L.validateImport(parsed);
    if (!check.ok) {
      status.textContent = t('importErr', { e: check.error });
      status.classList.add('error');
      return false;
    }
    state.results = parsed.results;
    persistResults();
    renderHistory();
    status.textContent = t('importOk', { n: parsed.results.length });
    status.classList.remove('error');
    return true;
  }
  function eraseAll() {
    var status = $('erase-status');
    if ($('erase-input').value.trim() !== 'DELETE') {
      status.textContent = t('eraseWrong');
      status.classList.add('error');
      return;
    }
    state.results = [];
    persistResults();
    renderHistory();
    $('erase-input').value = '';
    status.textContent = t('erasedMsg');
    status.classList.remove('error');
  }

  // ---------- tabs ----------
  function switchTab(name) {
    document.querySelectorAll('.tab-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === name);
    });
    ['test', 'history', 'data'].forEach(function (n) {
      $('view-' + n).classList.toggle('hidden', n !== name);
    });
  }

  // ---------- wiring ----------
  function init() {
    loadPersisted();
    document.querySelectorAll('.tab-btn').forEach(function (b) {
      b.addEventListener('click', function () { switchTab(b.dataset.tab); });
    });
    $('lang-toggle').addEventListener('click', function () {
      setLang(state.lang === 'en' ? 'bn' : 'en');
    });
    $('play-calib-btn').addEventListener('click', playCalibration);
    $('play-left-btn').addEventListener('click', function () { playChannel('left'); });
    $('play-right-btn').addEventListener('click', function () { playChannel('right'); });
    $('heard-left-btn').addEventListener('click', function () { answerChannel('left'); });
    $('heard-right-btn').addEventListener('click', function () { answerChannel('right'); });
    $('heard-both-btn').addEventListener('click', function () { answerChannel('both'); });
    $('start-test-btn').addEventListener('click', startTest);
    $('heard-btn').addEventListener('click', function () { answerHeard(true); });
    $('notheard-btn').addEventListener('click', function () { answerHeard(false); });
    $('replay-btn').addEventListener('click', function () {
      var tst = state.test;
      if (tst.active && tst.staircase) {
        playTone(tst.staircase.freq, tst.staircase.level, currentEar() === 'left' ? -1 : 1);
      }
    });
    $('stop-test-btn').addEventListener('click', stopTest);
    $('save-result-btn').addEventListener('click', saveResult);
    $('retake-btn').addEventListener('click', function () {
      state.viewing = null;
      showCard('setup-card');
      updateSetupUI();
    });
    $('export-btn').addEventListener('click', downloadExport);
    $('import-btn').addEventListener('click', function () {
      doImportFromText($('import-text').value);
    });
    $('erase-btn').addEventListener('click', eraseAll);
    applyLang();
    updateSetupUI();
    showCard('setup-card');
  }

  // Test hooks (smoke harness + debugging).
  window.__ht = {
    state: state,
    startTest: startTest,
    answerHeard: answerHeard,
    playTone: playTone,
    exportJSON: exportJSON,
    doImportFromText: doImportFromText,
    setLang: setLang,
    renderResults: renderResults,
    switchTab: switchTab
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
