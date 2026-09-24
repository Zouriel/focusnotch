'use strict';

/**
 * The top-edge gesture: cursor into the very top row of the screen, within the
 * notch's own span, and the notch gets out of the way until you leave.
 *
 * Driven by polling the OS cursor (Windows has no layer shell), which is why
 * the reveal delay is tracked as a *timestamp* rather than a setTimeout. A
 * timer restarted on every poll tick can never fire when the poll interval is
 * shorter than the delay, which is precisely how this got stuck hidden.
 *
 * The delay is measured from the last sample that was still in the band, so a
 * stalled or slow poll reveals promptly rather than waiting another delay.
 */
class EdgeWatcher {
  constructor({ revealDelayMs = 150, now = Date.now } = {}) {
    this.revealDelayMs = revealDelayMs;
    this.now = now;
    this.hidden = false;
    this.lastIn = null;
  }

  /**
   * Feed one poll sample. Returns true when the hidden state changed.
   */
  update(inTrigger) {
    const before = this.hidden;

    if (inTrigger) {
      this.hidden = true;
      this.lastIn = this.now();
    } else if (this.hidden && this.lastIn !== null && this.now() - this.lastIn >= this.revealDelayMs) {
      this.hidden = false;
      this.lastIn = null;
    }

    return this.hidden !== before;
  }

  /** Force back into view, e.g. when the gesture is switched off. */
  reset() {
    const changed = this.hidden;
    this.hidden = false;
    this.lastIn = null;
    return changed;
  }
}

/** Is the point in the top band, within the notch's horizontal span? */
function inTopEdge(point, display, rect, band) {
  if (!rect) return false;
  return (
    point.y <= display.y + band &&
    point.y >= display.y - 1 &&
    point.x >= rect.x &&
    point.x <= rect.x + rect.width
  );
}

module.exports = { EdgeWatcher, inTopEdge };
