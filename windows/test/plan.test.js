'use strict';

/**
 * The break plan is the one piece of real logic here, and the rule that
 * matters is structural: a break is only ever *between* two work blocks.
 * Checked across every duration rather than a couple of examples.
 */

const assert = require('assert');
const { Session } = require('../src/lib/session');

const config = {
  get: (key, fallback) =>
    ({
      defaultMinutes: 30,
      breaks: { minSessionMinutes: 30, everyMinutes: 20, lengthMinutes: 5 },
      breakOverlay: {},
    })[key] ?? fallback,
};

const session = new Session(config);
session.setBreaks(true);

for (let m = 1; m <= 240; m++) {
  session.setMinutes(m);
  const plan = session.plan;
  const where = `at ${m} min: ${plan.map((p) => p.kind[0] + p.secs / 60).join(' ')}`;

  assert.strictEqual(plan[0].kind, 'work', `plan starts with a break ${where}`);
  assert.strictEqual(plan[plan.length - 1].kind, 'work', `plan ends with a break ${where}`);

  for (let i = 0; i < plan.length - 1; i++) {
    assert.ok(
      !(plan[i].kind === 'break' && plan[i + 1].kind === 'break'),
      `two breaks in a row ${where}`
    );
  }

  const focus = plan.filter((p) => p.kind === 'work').reduce((a, p) => a + p.secs, 0);
  assert.strictEqual(focus, m * 60, `focus time is not the duration picked ${where}`);
}

// Below the threshold there should be no breaks at all.
session.setMinutes(25);
assert.strictEqual(session.plan.length, 1, '25 min should not be split');

// And a stub final block is folded rather than left as a sliver.
session.setMinutes(45);
assert.deepStrictEqual(
  session.plan.map((p) => `${p.kind[0]}${p.secs / 60}`),
  ['w20', 'b5', 'w25'],
  '45 min should fold to 20 + 25'
);

session.destroy();
console.log('plan: 240 durations checked, all structural rules hold');
