// Hearing Test BD headless-Chrome smoke test (raw CDP, headless_shell).
// Run: node smoke/smoke.mjs
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PAGE = 'file://' + path.resolve(DIR, '..', 'index.html');
const CHROME = process.env.HEADLESS_SHELL ||
  (process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1187/chrome-linux/headless_shell');
const PORT = 9231;

const results = [];
function check(name, cond, extra) {
  results.push([name, !!cond]);
  console.log((cond ? 'ok - ' : 'FAIL - ') + name + (extra !== undefined ? ' :: ' + extra : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { if (await fn()) return true; } catch (e) { /* retry */ }
    await sleep(200);
  }
  throw new Error('timeout waiting for: ' + label);
}

async function main() {
  const child = spawn(CHROME, [
    '--headless', '--no-sandbox', '--disable-gpu',
    '--remote-debugging-port=' + PORT, '--remote-debugging-address=127.0.0.1',
    'about:blank',
  ], { stdio: 'ignore' });
  try {
    let version = null;
    await waitFor(async () => {
      const res = await fetch('http://127.0.0.1:' + PORT + '/json/version');
      if (!res.ok) return false;
      version = await res.json();
      return true;
    }, 20000, 'debugger port');
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0;
    const pending = new Map();
    const consoleErrors = [];
    const exceptions = [];
    const onMsg = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error))); else res(msg.result);
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        exceptions.push(msg.params.exceptionDetails.exception?.description || 'exception');
      }
    };
    ws.onmessage = onMsg;
    const send = (method, params) => new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
    });
    const target = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?about:blank', { method: 'PUT' })).json();
    const tws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { tws.onopen = res; tws.onerror = rej; });
    const tpending = new Map();
    let tid = 0;
    tws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && tpending.has(msg.id)) {
        const { res, rej } = tpending.get(msg.id);
        tpending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error))); else res(msg.result);
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        exceptions.push(msg.params.exceptionDetails.exception?.description || 'exception');
      }
    };
    const tsend = (method, params) => new Promise((res, rej) => {
      const mid = ++tid;
      tpending.set(mid, { res, rej });
      tws.send(JSON.stringify({ id: mid, method, params: params || {} }));
    });
    const teval = async (expr) => {
      const r = await tsend('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
      return r.result.value;
    };
    await tsend('Runtime.enable');
    await tsend('Page.enable');
    await tsend('Page.navigate', { url: PAGE });
    await waitFor(async () => (await teval('document.getElementById("app-title").textContent')) === 'Hearing Test BD', 10000, 'app loads');

    // 1. Setup renders; start is gated on the checks.
    check('app title is Hearing Test BD', await teval('document.getElementById("app-title").textContent') === 'Hearing Test BD');
    check('setup warning mentions screening not diagnosis', await teval('document.getElementById("setup-3").textContent.includes("not a diagnosis")'));
    check('start button disabled before checks', await teval('document.getElementById("start-test-btn").disabled') === true);
    check('footer disclaimer present', await teval('document.getElementById("footer-note").textContent.includes("not clinical dB HL")'));

    // 2. Calibration enables only the calibration half of the gate.
    await teval(`document.getElementById('play-calib-btn').click()`);
    await sleep(300);
    check('calibration status shown', await teval('document.getElementById("calib-status").textContent.length') > 0);
    check('start still disabled after calibration alone', await teval('document.getElementById("start-test-btn").disabled') === true);

    // 3. Channel check: wrong ear is rejected, correct ears confirm.
    await teval(`document.getElementById('play-left-btn').click()`);
    await sleep(200);
    await teval(`document.getElementById('heard-right-btn').click()`);
    await sleep(200);
    check('wrong ear answer shows error', await teval('document.getElementById("chan-status").classList.contains("error")'));
    check('start still disabled after wrong ear answer', await teval('document.getElementById("start-test-btn").disabled') === true);
    await teval(`document.getElementById('play-left-btn').click()`);
    await sleep(200);
    await teval(`document.getElementById('heard-left-btn').click()`);
    await sleep(200);
    check('left ear confirmed', await teval('__ht.state.setup.chanLeft') === true);
    await teval(`document.getElementById('play-right-btn').click()`);
    await sleep(200);
    await teval(`document.getElementById('heard-right-btn').click()`);
    await sleep(200);
    check('right ear confirmed', await teval('__ht.state.setup.chanRight') === true);
    check('start enabled after all checks', await teval('document.getElementById("start-test-btn").disabled') === false);

    // 4. Start the test; first step is left ear 500 Hz.
    await teval(`document.getElementById('start-test-btn').click()`);
    await sleep(300);
    check('test card visible after start', await teval('!document.getElementById("test-card").classList.contains("hidden")'));
    check('step shows 1 of 8', await teval('document.getElementById("test-step").textContent') === 'Step 1 of 8');
    check('first step is left ear 500 Hz', await teval('document.getElementById("test-ear-freq").textContent') === 'Left ear - 500 Hz tone');

    // 5. Scripted full test: consistent responder, known thresholds.
    // left: 500:4, 1000:4, 2000:6, 4000:8 ; right: all 2.
    const PROFILE = { left: { 500: 4, 1000: 4, 2000: 6, 4000: 8 }, right: { 500: 2, 1000: 2, 2000: 2, 4000: 2 } };
    let guard = 0;
    while (await teval('__ht.state.test.active') && guard < 120) {
      guard++;
      const step = await teval('({ear: __ht.state.test.staircase ? (__ht.state.test.earIdx === 0 ? "left" : "right") : null, freq: __ht.state.test.staircase ? __ht.state.test.staircase.freq : null, level: __ht.state.test.staircase ? __ht.state.test.staircase.level : null})');
      const T = PROFILE[step.ear][step.freq];
      await teval(`__ht.answerHeard(${step.level >= T})`);
      await sleep(30);
    }
    check('scripted test finished within guard', guard < 120, 'presentations=' + guard);
    check('test inactive after finish', await teval('__ht.state.test.active') === false);
    check('results card visible', await teval('!document.getElementById("results-card").classList.contains("hidden")'));
    const th = await teval('__ht.state.viewing');
    check('left thresholds recovered exactly', JSON.stringify(th.left) === JSON.stringify({ 500: 4, 1000: 4, 2000: 6, 4000: 8 }), JSON.stringify(th.left));
    check('right thresholds recovered exactly', JSON.stringify(th.right) === JSON.stringify({ 500: 2, 1000: 2, 2000: 2, 4000: 2 }), JSON.stringify(th.right));

    // 6. Audiogram + summary render.
    check('audiogram SVG rendered', await teval('document.querySelectorAll("#audiogram svg").length') === 1);
    check('audiogram has 4 left-ear circles', await teval('document.querySelectorAll("#audiogram svg circle").length') === 4);
    check('audiogram has 4 right-ear squares', await teval('document.querySelectorAll("#audiogram svg rect").length') === 4);
    check('summary has 2 ear blocks', await teval('document.querySelectorAll(".summary-ear").length') === 2);
    check('asymmetric flag shown (left 4000Hz=8 vs right=2)', await teval('document.getElementById("results-flags").textContent.includes("4000")'));
    check('left average 5.5 shown', await teval('document.querySelectorAll(".summary-ear")[0].textContent.includes("5.5")'));

    // 7. Save to history, then view from history.
    await teval(`(() => { document.getElementById('result-note').value = 'smoke room'; })()`);
    await teval(`document.getElementById('save-result-btn').click()`);
    await sleep(300);
    check('saved message shown', await teval('document.getElementById("saved-msg").textContent.includes("saved")'));
    check('save button disabled after save (no duplicates)', await teval('document.getElementById("save-result-btn").disabled') === true);
    check('1 result in localStorage', await teval('JSON.parse(localStorage.getItem("htbd-results-v1")).length') === 1);
    await teval(`document.querySelector('.tab-btn[data-tab="history"]').click()`);
    await sleep(300);
    check('history lists 1 item', await teval('document.querySelectorAll("#history-list li").length') === 1);
    check('history item shows note', await teval('document.querySelector("#history-list li").textContent.includes("smoke room")'));
    await teval(`document.querySelector('#history-list li .btn').click()`);
    await sleep(300);
    check('view from history shows results card', await teval('!document.getElementById("results-card").classList.contains("hidden")'));

    // 8. Export/import round-trip via logic.
    check('exported JSON passes strict import validation', await teval('HearingLogic.validateImport(JSON.parse(__ht.exportJSON())).ok') === true);
    check('bad import rejected and data intact', await teval('__ht.doImportFromText(\'{"app":"wrong-app","version":1,"results":[]}\')') === false &&
      (await teval('JSON.parse(localStorage.getItem("htbd-results-v1")).length')) === 1);
    check('re-import of own export succeeds', await teval('__ht.doImportFromText(__ht.exportJSON())') === true);
    check('import status message shown', await teval('document.getElementById("import-status").textContent.length') > 0);

    // 9. Erase flow: wrong word rejected, DELETE works.
    await teval(`document.querySelector('.tab-btn[data-tab="data"]').click()`);
    await sleep(200);
    await teval(`(() => { document.getElementById('erase-input').value = 'delete'; })()`);
    await teval(`document.getElementById('erase-btn').click()`);
    await sleep(200);
    check('wrong erase word rejected, data intact', await teval('JSON.parse(localStorage.getItem("htbd-results-v1")).length') === 1);
    await teval(`(() => { document.getElementById('erase-input').value = 'DELETE'; })()`);
    await teval(`document.getElementById('erase-btn').click()`);
    await sleep(200);
    check('DELETE erases all results', await teval('JSON.parse(localStorage.getItem("htbd-results-v1")).length') === 0);
    check('history empty state shown', await teval('!document.getElementById("hist-empty").classList.contains("hidden")'));

    // 10. Bangla toggle renders Bengali and persists after reload.
    await teval(`document.getElementById('lang-toggle').click()`);
    await sleep(300);
    check('Bangla title renders (non-ASCII)', await teval('/[^\\x00-\\x7F]/.test(document.getElementById("app-title").textContent)'));
    check('language persisted in localStorage', await teval('localStorage.getItem("htbd-lang-v1")') === 'bn');
    await tsend('Page.navigate', { url: PAGE });
    await waitFor(async () => (await teval('document.getElementById("app-title").textContent')).length > 0, 10000, 'reload after BN');
    check('Bangla still active after reload', await teval('localStorage.getItem("htbd-lang-v1") === "bn" && /[^\\x00-\\x7F]/.test(document.getElementById("app-title").textContent)'));
    await teval(`document.getElementById('lang-toggle').click()`);
    await sleep(300);
    check('toggle back to English', await teval('document.getElementById("app-title").textContent') === 'Hearing Test BD');

    // 11. Mobile 390px: no horizontal overflow on all tabs.
    await tsend('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(500);
    check('no overflow at 390px (test tab)', await teval('document.documentElement.scrollWidth <= 391'));
    await teval(`document.querySelector('.tab-btn[data-tab="history"]').click()`);
    await sleep(300);
    check('no overflow at 390px (history tab)', await teval('document.documentElement.scrollWidth <= 391'));
    await teval(`document.querySelector('.tab-btn[data-tab="data"]').click()`);
    await sleep(300);
    check('no overflow at 390px (data tab)', await teval('document.documentElement.scrollWidth <= 391'));

    // 12. No console errors / exceptions.
    check('zero console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
    check('zero page exceptions', exceptions.length === 0, exceptions.join(' | '));

    tws.close(); ws.close();
  } finally {
    child.kill();
  }
  const failed = results.filter((r) => !r[1]).length;
  console.log(failed === 0 ? 'SMOKE PASS: ' + results.length + '/' + results.length : 'SMOKE FAIL: ' + failed + ' failures');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error('SMOKE ERROR:', e.message); process.exit(1); });
