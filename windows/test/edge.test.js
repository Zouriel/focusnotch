'use strict';

/**
 * The bug this guards: the reveal used to be a setTimeout that the cursor poll
 * cleared and restarted on every tick. With a poll faster than the delay the
 * timer could never fire, so the notch disappeared and never came back.
 *
 * Assertions are written against elapsed time rather than counted ticks, so
 * they say what the behaviour should be instead of encoding one poll rate.
 */

const assert = require('assert');
const { EdgeWatcher, inTopEdge } = require('../src/lib/edge');

const DELAY = 150;
const POLL = 70;

let clock = 0;
const watcher = new EdgeWatcher({ revealDelayMs: DELAY, now: () => clock });

/** Poll with `inTrigger` until `done()`, returning ms elapsed. Fails if stuck. */
function pollUntil(inTrigger, done, label, limit = 5000) {
  const start = clock;
  while (clock - start <= limit) {
    if (done()) return clock - start;
    clock += POLL;
    watcher.update(inTrigger);
  }
  assert.fail(`${label}: never happened within ${limit}ms (this is the stuck-hidden bug)`);
}

// Entering the band hides it, immediately.
assert.strictEqual(watcher.update(true), true, 'entering the band should hide');
assert.strictEqual(watcher.hidden, true);

// Staying put keeps it hidden without re-firing.
clock += POLL;
assert.strictEqual(watcher.update(true), false, 'staying should not re-fire');
assert.strictEqual(watcher.hidden, true);

// Leaving brings it back, and takes roughly the reveal delay to do so.
const revealed = pollUntil(false, () => !watcher.hidden, 'first reveal');
assert.ok(revealed >= DELAY, `revealed too eagerly after ${revealed}ms`);
assert.ok(revealed < DELAY + 3 * POLL, `revealed too slowly after ${revealed}ms`);

// It stays back.
clock += 1000;
assert.strictEqual(watcher.update(false), false);
assert.strictEqual(watcher.hidden, false);

// The cycle repeats: this is what actually broke for the user.
for (let cycle = 0; cycle < 5; cycle++) {
  watcher.update(true);
  assert.strictEqual(watcher.hidden, true, `cycle ${cycle}: should hide again`);
  pollUntil(false, () => !watcher.hidden, `cycle ${cycle} reveal`);
}

// Dipping back into the band during the wait cancels the reveal.
watcher.update(true);
clock += POLL;
watcher.update(false);
clock += POLL;
watcher.update(true);
clock += 5000;
assert.strictEqual(watcher.hidden, true, 're-entering should keep it hidden');

// A stalled poll reveals on the next tick rather than waiting another delay,
// because the delay is measured from the last in-band sample.
watcher.reset();
watcher.update(true);
clock += 5000;
watcher.update(false);
assert.strictEqual(watcher.hidden, false, 'a stalled poll should not restart the wait');

// reset() forces it back, for when the gesture is switched off entirely.
watcher.update(true);
assert.strictEqual(watcher.reset(), true);
assert.strictEqual(watcher.hidden, false);
assert.strictEqual(watcher.reset(), false, 'reset is idempotent');

// Geometry: only the notch's own span counts, not the whole screen edge.
const display = { x: 0, y: 0 };
const rect = { x: 500, y: 0, width: 300, height: 40 };
assert.ok(inTopEdge({ x: 600, y: 0 }, display, rect, 3), 'top row over the notch');
assert.ok(inTopEdge({ x: 600, y: 3 }, display, rect, 3), 'bottom of the band');
assert.ok(!inTopEdge({ x: 600, y: 8 }, display, rect, 3), 'below the band');
assert.ok(!inTopEdge({ x: 100, y: 0 }, display, rect, 3), 'top row away from the notch');
assert.ok(!inTopEdge({ x: 600, y: 0 }, display, null, 3), 'no rect reported yet');

// A second monitor above the primary must not count as the top edge.
const lower = { x: 0, y: 1080 };
const lowerRect = { x: 500, y: 1080, width: 300, height: 40 };
assert.ok(inTopEdge({ x: 600, y: 1080 }, lower, lowerRect, 3), 'top of the primary display');
assert.ok(!inTopEdge({ x: 600, y: 0 }, lower, lowerRect, 3), 'top of a display above it');

console.log('edge: hide/reveal cycles, stalls and geometry all hold');
