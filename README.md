# Hearing Test BD

Offline, bilingual (English / বাংলা) hearing screening test that runs entirely in the browser. Put on headphones, set a comfortable volume, confirm left/right ears, then answer “I heard it” / “I didn’t hear it” for short tones at 500, 1000, 2000 and 4000 Hz in each ear. The app finds your hearing threshold at each tone with a simplified Hughson–Westlake staircase, draws your audiogram, and saves results on your device.

Live: https://fahad3235.github.io/hearing-test-bd/

## The honest model — read this first

This app has **no calibrated hardware**, so it **cannot measure clinical dB HL**. Results are reported in **relative levels 0–10**: each level is a 5 dB amplitude step relative to the device volume you set during calibration (full range 50 dB). A threshold is the lowest relative level at which you hear a tone. The audiogram therefore shows the **shape** of your hearing — which tones need louder levels, and whether one ear is worse than the other — not a clinical diagnosis. The app never assigns a hearing-loss category (normal / mild / moderate …) because that would require calibrated dB HL. If you are worried about your hearing, see an audiologist or ENT doctor.

## Features

- **Volume calibration** — play a 1000 Hz tone and set a comfortable device volume; the test uses that volume throughout.
- **Left/right ear check** — tones are played in one ear only (stereo pan); you must identify the correct ear before the test starts, so reversed headphones are caught.
- **Pure-tone staircase test** — 4 frequencies × 2 ears (8 thresholds). Simplified Hughson–Westlake: heard → 2 levels quieter, not heard → 1 level louder; a threshold is confirmed when the same level is heard twice, or when level 0 is heard. No response at the loudest level twice → “No response”. Hard cap of 12 presentations per tone.
- **Audiogram (SVG)** — per-ear lines (left = teal circles, right = blue squares), “NR” markers where there was no response at the loudest level.
- **Plain-language summary** — per-ear average level and a verdict in words (“heard at low levels…”, “needed loud levels…”, “no response…”), plus flags for ear asymmetry (≥ 3 levels apart at any frequency) and high levels.
- **History** — save results with an optional note, view any past audiogram, delete with two-tap confirm.
- **Data** — JSON export / import with strict validation (wrong app, wrong version, bad thresholds, duplicate ids all rejected, existing data left intact). Typed `DELETE` erases everything.
- **Bilingual** — EN / বাংলা toggle, persisted; Bengali digits in Bangla mode.
- **Offline-first** — zero network requests by design; all data stays in `localStorage` on your device.

## Stack

Vanilla HTML/CSS/JS, no dependencies, no build step. Audio is the Web Audio API (`OscillatorNode` + `GainNode` + `StereoPannerNode`). Test logic lives in `js/hearing.js` with no DOM access, so it is unit-testable in Node.

## Run

Open `index.html` in a browser, or serve the directory with any static server:

```bash
npx serve .
# or
python3 -m http.server 8000
```

Headphones are required. Use a quiet room and do not change the device volume after calibration.

## Testing

```bash
node --test tests/logic.test.js   # pure-logic unit tests (staircase, summary, validation)
node smoke/smoke.mjs              # headless-Chrome smoke test (raw CDP, file://)
```

Results: see [TEST_RESULTS.md](TEST_RESULTS.md) — 16/16 unit + 47/47 smoke, 0 console errors.

## Limitations

- **Not a medical device.** Screening only; not a diagnosis, not a substitute for a clinical audiogram.
- **Levels are relative, not dB HL.** Absolute hearing-loss categories cannot be derived from this test.
- Results depend on your headphones, device volume, and room noise. Retest in a quieter room if a result surprises you.
- Screening set is 500–4000 Hz only; a clinical test also covers 250 Hz and 6000–8000 Hz.
- Tone playback needs a browser with Web Audio; if audio is blocked, the test flow still runs but the tones will not be audible (the app never pretends a tone was heard).

## Status

Working MVP. See [TEST_RESULTS.md](TEST_RESULTS.md) for the verified numbers.
