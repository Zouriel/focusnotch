'use strict';

/**
 * The focus session.
 *
 * A session is a plan: work blocks with breaks strictly between them. With
 * breaks off the plan is a single work block.
 *
 * The duration you pick is *focus* time, not elapsed time: 60 minutes means
 * 60 minutes of work, and the breaks are added on top. So the chips keep
 * meaning what they say.
 *
 * This is a direct port of the Linux build's Focus.qml so both platforms
 * behave identically.
 */

const { EventEmitter } = require('events');

const TICK_MS = 200;

class Session extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;

    this.minutes = config.get('defaultMinutes', 30);
    this.breaksEnabled = false;

    this.running = false;
    this.finished = false;

    this.plan = [{ kind: 'work', secs: this.minutes * 60 }];
    this.phase = 0;
    this.remaining = this.minutes * 60;
    this.deadline = 0;

    // Break-screen state. Dismissing hides the screen but leaves the break
    // running: it is a nudge, not a cage.
    this.breakDismissed = false;
    this.backToWork = false;
    this.finishedDismissed = false;
    this.previewKind = null;

    this._backToWorkTimer = null;
    this._previewTimer = null;
    this._autoDismiss = null;

    this._tick = setInterval(() => this._onTick(), TICK_MS);
    this.rebuild();
  }

  // ---- derived -------------------------------------------------------------

  get breakCfg() {
    return this.config.get('breaks', {});
  }
  get breakEvery() {
    return (this.breakCfg.everyMinutes ?? 20) * 60;
  }
  get breakLength() {
    return (this.breakCfg.lengthMinutes ?? 5) * 60;
  }
  get breakMinSession() {
    return (this.breakCfg.minSessionMinutes ?? 30) * 60;
  }

  get breaksApply() {
    return (
      this.breaksEnabled &&
      this.minutes * 60 >= this.breakMinSession &&
      this.breakEvery > 0 &&
      this.breakLength > 0
    );
  }

  get current() {
    return this.plan[this.phase] ?? { kind: 'work', secs: 0 };
  }
  get onBreak() {
    return this.current.kind === 'break';
  }
  get workBlocks() {
    return this.plan.filter((p) => p.kind === 'work').length;
  }
  get workBlockIndex() {
    return this.plan.slice(0, this.phase + 1).filter((p) => p.kind === 'work').length;
  }
  get planTotal() {
    return this.plan.reduce((a, p) => a + p.secs, 0);
  }

  get planElapsed() {
    let done = 0;
    // Bounded by the plan as well as by phase, so a rebuild cannot read past
    // the end of the new plan.
    for (let i = 0; i < this.phase && i < this.plan.length; i++) done += this.plan[i].secs;
    return done + Math.max(0, this.current.secs - this.remaining);
  }

  get active() {
    return this.running || this.phase > 0 || this.remaining < this.current.secs;
  }
  get progress() {
    return this.planTotal > 0 ? this.planElapsed / this.planTotal : 0;
  }

  /**
   * Which full-screen card to show, if any: 'break', 'back' or 'done'.
   *
   * The end of a session gets one too. It used to be a chime and a small
   * glow on the notch, which is less than a break got -- backwards, for the
   * thing you were actually waiting for.
   */
  get overlayKind() {
    if (this.config.get('breakOverlay', {}).enabled === false) return null;
    if (this.previewKind) return this.previewKind;
    if (this.finished && !this.finishedDismissed) return 'done';
    if (this.backToWork) return 'back';
    if (this.onBreak && !this.breakDismissed) return 'break';
    return null;
  }

  get showOverlay() {
    return this.overlayKind !== null;
  }

  // ---- the plan ------------------------------------------------------------

  /**
   * Split the chosen focus time into work blocks with breaks between them.
   * No break after the final block, and a stub final block gets folded into
   * the one before it rather than leaving a two-minute sliver.
   */
  buildPlan() {
    const total = this.minutes * 60;
    if (!this.breaksApply) return [{ kind: 'work', secs: total }];

    const blocks = [];
    let left = total;
    while (left > 0) {
      const c = Math.min(this.breakEvery, left);
      blocks.push(c);
      left -= c;
    }
    // A final sliver is worse than a slightly long last block: taking a five
    // minute break to then work five minutes is silly.
    if (blocks.length > 1 && blocks[blocks.length - 1] < this.breakEvery / 2) {
      blocks[blocks.length - 2] += blocks.pop();
    }

    const out = [];
    for (let i = 0; i < blocks.length; i++) {
      out.push({ kind: 'work', secs: blocks[i] });
      if (i < blocks.length - 1) out.push({ kind: 'break', secs: this.breakLength });
    }
    return out;
  }

  rebuild() {
    // Rewind first, so nothing reads past the end of a shorter new plan.
    this.phase = 0;
    this.plan = this.buildPlan();
    this.remaining = this.plan[0].secs;
    this.finished = false;
    this.emit('changed');
  }

  // ---- controls ------------------------------------------------------------

  start() {
    if (this.running) return;
    this.finished = false;
    if (this.remaining <= 0) this.remaining = this.current.secs;
    this.deadline = Date.now() + this.remaining * 1000;
    this.running = true;
    this.emit('started');
    this.emit('changed');
  }

  pause() {
    if (!this.running) return;
    this.remaining = Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000));
    this.running = false;
    this.emit('paused');
    this.emit('changed');
  }

  toggle() {
    if (this.running) this.pause();
    else this.start();
  }

  reset() {
    this.running = false;
    this.dismissOverlay();
    this.rebuild();
    this.emit('reset');
  }

  setMinutes(m) {
    if (!(m > 0)) return;
    const wasRunning = this.running;
    this.minutes = m;
    this.running = false;
    this.rebuild();
    if (wasRunning) this.start();
    this.emit('persist');
  }

  setBreaks(on) {
    const wasRunning = this.running;
    this.breaksEnabled = !!on;
    this.running = false;
    this.rebuild();
    if (wasRunning) this.start();
    this.emit('persist');
  }

  /** End a break early and get on with the next work block. */
  skip() {
    if (!this.onBreak) return;
    this.breakDismissed = true;
    this.remaining = 0;
    this.advance();
    if (!this.running) this.start();
  }

  /** Send whichever card is up away, without changing the session itself. */
  dismissOverlay() {
    this.breakDismissed = true;
    this.finishedDismissed = true;
    this.backToWork = false;
    this.previewKind = null;
    clearTimeout(this._backToWorkTimer);
    clearTimeout(this._previewTimer);
    this.emit('changed');
  }

  /** Show a card without waiting for the real thing: 'break', 'back', 'done'. */
  preview(kind = 'break') {
    this.previewKind = ['break', 'back', 'done'].includes(kind) ? kind : 'break';
    clearTimeout(this._previewTimer);
    this._previewTimer = setTimeout(() => {
      this.previewKind = null;
      this.emit('changed');
    }, 8000);
    this.emit('changed');
  }

  dismissFinished() {
    this.finished = false;
    this.finishedDismissed = true;
    this.backToWork = false;
    this.rebuild();
  }

  /** Dismiss the "time's up" card and run the same session again. */
  restart() {
    this.reset();
    this.start();
  }

  // ---- the clock -----------------------------------------------------------

  _onTick() {
    if (!this.running) return;
    const left = Math.ceil((this.deadline - Date.now()) / 1000);
    this.remaining = Math.max(0, left);
    if (left <= 0) this.advance();
    else this.emit('tick');
  }

  /** Move to the next phase, or finish if that was the last one. */
  advance() {
    if (this.phase + 1 >= this.plan.length) {
      this.complete();
      return;
    }

    this.phase += 1;
    this.remaining = this.current.secs;
    this.deadline = Date.now() + this.remaining * 1000;

    if (this.onBreak) {
      this.breakDismissed = false;
      this.backToWork = false;
      this.emit('breakStarted', {
        minutes: Math.round(this.current.secs / 60),
        block: this.workBlockIndex,
        blocks: this.workBlocks,
      });
    } else {
      // Only greet you back if you never dismissed the break screen --
      // otherwise you are already working and do not want a popup.
      if (!this.breakDismissed) {
        this.backToWork = true;
        this._armBackToWork();
      }
      this.emit('breakEnded', { block: this.workBlockIndex, blocks: this.workBlocks });
    }
    this.emit('changed');
  }

  complete() {
    this.running = false;
    this.remaining = 0;
    this.finished = true;
    this.finishedDismissed = false;
    this.backToWork = false;
    clearTimeout(this._backToWorkTimer);

    this.emit('completed', { minutes: this.minutes });
    this.emit('changed');

    // Stop glowing at me eventually.
    clearTimeout(this._autoDismiss);
    this._autoDismiss = setTimeout(() => this.dismissFinished(), 60000);
  }

  _armBackToWork() {
    clearTimeout(this._backToWorkTimer);
    const secs = this.config.get('breakOverlay', {}).backToWorkSeconds ?? 6;
    this._backToWorkTimer = setTimeout(() => {
      this.backToWork = false;
      this.emit('changed');
    }, secs * 1000);
  }

  // ---- view model ----------------------------------------------------------

  snapshot() {
    return {
      minutes: this.minutes,
      remaining: this.remaining,
      running: this.running,
      finished: this.finished,
      onBreak: this.onBreak,
      breaks: this.breaksEnabled,
      breaksApply: this.breaksApply,
      breakMinSession: this.breakMinSession,
      breakLength: this.breakLength,
      block: this.workBlockIndex,
      blocks: this.workBlocks,
      plan: this.plan,
      planTotal: this.planTotal,
      phase: this.phase,
      active: this.active,
      progress: this.progress,
      overlayKind: this.overlayKind,
      showOverlay: this.showOverlay,
      previewing: this.previewKind !== null,
      breakDismissed: this.breakDismissed,
    };
  }

  destroy() {
    clearInterval(this._tick);
    clearTimeout(this._backToWorkTimer);
    clearTimeout(this._previewTimer);
    clearTimeout(this._autoDismiss);
  }
}

module.exports = { Session };
