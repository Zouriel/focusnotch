'use strict';

/**
 * Every icon a renderer asks for must exist in the bundled font.
 *
 * The 1.0.1 bug was relying on Material Symbols being installed: on a stock
 * Windows box it is not, so ligature names rendered as the literal words
 * ("check_box_outline_blank") and stretched the buttons into paragraphs. The
 * font is bundled now, but the set is finite, so a new icon added to a
 * renderer without rebuilding the font would silently draw nothing.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const RENDERER = path.join(__dirname, '..', 'src', 'renderer');
const { ICONS } = require(path.join(RENDERER, 'icons.js'));

assert.ok(Object.keys(ICONS).length > 0, 'icons.js is empty; run tools/build-icons.py');

// The font file itself has to be there, and be a real font rather than a stub.
const fontPath = path.join(__dirname, '..', 'assets', 'fonts', 'icons.ttf');
assert.ok(fs.existsSync(fontPath), 'assets/fonts/icons.ttf is missing');
const head = fs.readFileSync(fontPath).subarray(0, 4);
assert.ok(
  head.equals(Buffer.from([0x00, 0x01, 0x00, 0x00])) || head.toString('latin1') === 'true',
  'icons.ttf does not look like a TrueType font'
);

// Collect every icon name the renderers reference.
const used = new Map(); // name -> where

for (const file of fs.readdirSync(RENDERER)) {
  if (file === 'icons.js') continue;
  const text = fs.readFileSync(path.join(RENDERER, file), 'utf8');

  for (const m of text.matchAll(/data-icon="([^"]+)"/g)) used.set(m[1], file);
  for (const m of text.matchAll(/setIcon\([^,]+,\s*([^)]+)\)/g)) {
    for (const lit of m[1].matchAll(/'([^']+)'/g)) used.set(lit[1], file);
  }
  // Nothing should still be assigning a bare ligature name as text.
  for (const m of text.matchAll(/\.textContent\s*=\s*'([a-z]+_[a-z_]+)'/g)) {
    assert.fail(`${file}: '${m[1]}' assigned as text; use setIcon() so it works without the system font`);
  }
}

assert.ok(used.size > 0, 'found no icon references at all - did the scan break?');

const missing = [...used].filter(([name]) => !(name in ICONS));
assert.deepStrictEqual(
  missing,
  [],
  `used by a renderer but not in the bundled font: ${missing
    .map(([n, f]) => `${n} (${f})`)
    .join(', ')}. Add it to ICONS in tools/build-icons.py and rebuild.`
);

console.log(`icons: ${used.size} referenced, all present in the ${Object.keys(ICONS).length}-glyph bundle`);
