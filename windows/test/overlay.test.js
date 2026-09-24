'use strict';

/**
 * Which card the overlay shows. The end of a session now gets one, and it has
 * to win over the others: finishing during a break must show "time's up",
 * not leave the break card up.
 */

const assert = require('assert');
const { Session } = require('../src/lib/session');

const make = (overlay = {}) =>
  new Session({
    get: (key, fallback) =>
      ({
        defaultMinutes: 30,
        breaks: { minSessionMinutes: 30, everyMinutes: 20, lengthMinutes: 5 },
        breakOverlay: overlay,
      })[key] ?? fallback,
  });

let s = make();
assert.strictEqual(s.overlayKind, null, 'idle shows nothing');

// A break puts the break card up; dismissing it leaves the break running.
s.setBreaks(true);
s.setMinutes(60);
s.start();
s.advance(); // into the first break
assert.strictEqual(s.onBreak, true);
assert.strictEqual(s.overlayKind, 'break', 'a break shows the break card');
s.dismissOverlay();
assert.strictEqual(s.overlayKind, null, 'dismissed');
assert.strictEqual(s.onBreak, true, 'the break itself keeps running');

// Finishing shows the time's-up card, and it outranks anything else.
s.destroy();
s = make();
s.setMinutes(30);
s.start();
s.complete();
assert.strictEqual(s.finished, true);
assert.strictEqual(s.overlayKind, 'done', "finishing shows the time's-up card");

// Dismissing it clears the card and the finished state.
s.dismissOverlay();
assert.strictEqual(s.overlayKind, null, 'dismissed');
s.destroy();

// Completing while the back-to-work card is up must still show 'done'.
s = make();
s.backToWork = true;
assert.strictEqual(s.overlayKind, 'back');
s.complete();
assert.strictEqual(s.overlayKind, 'done', "'done' outranks the greeting");
s.destroy();

// Previews win over everything, so the tray can show any card on demand.
s = make();
for (const kind of ['break', 'back', 'done']) {
  s.preview(kind);
  assert.strictEqual(s.overlayKind, kind, `preview('${kind}')`);
}
s.preview('nonsense');
assert.strictEqual(s.overlayKind, 'break', 'an unknown preview falls back to break');
s.destroy();

// Turning the overlay off silences all of it, including the new card.
s = make({ enabled: false });
s.complete();
assert.strictEqual(s.overlayKind, null, 'disabled means no cards at all');
assert.strictEqual(s.finished, true, 'the session still finished, it is just not shouted about');
s.destroy();

// Restart clears the card and runs the same session again.
s = make();
s.setMinutes(15);
s.start();
s.complete();
assert.strictEqual(s.overlayKind, 'done');
s.restart();
assert.strictEqual(s.overlayKind, null, 'restart dismisses the card');
assert.strictEqual(s.running, true, 'and starts running again');
assert.strictEqual(s.minutes, 15, 'with the same duration');
s.destroy();

console.log('overlay: break / back / done precedence and dismissal all hold');
