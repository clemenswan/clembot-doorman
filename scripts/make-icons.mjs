#!/usr/bin/env node
/**
 * Build every icon surface from the canonical logo.
 *
 *   node scripts/make-icons.mjs
 *
 * ── Why a script and not five hand-cropped files ─────────────────────────────
 *
 * They are generated artifacts. Regenerate them together whenever
 * design/logo.png changes, so a favicon can never quietly disagree with the
 * mark it came from.
 *
 * ── Why the browser does the rasterising ─────────────────────────────────────
 *
 * This machine has no image toolchain: no sharp, no cwebp, no magick, no sips.
 * design-hub/scripts/make-favicons.mjs hit the same wall and solved it with
 * Playwright's canvas, so this follows that precedent rather than adding a
 * native dependency to a repo whose whole pitch is that it installs cleanly.
 *
 * The logo is passed in as a data URI, not a file:// URL. A file:// image taints
 * the canvas and blocks toDataURL.
 *
 * ── Why the icons are a CROP, not the whole logo ─────────────────────────────
 *
 * Measured, not guessed: the source is 2000x2000 and 56.2% of it is
 * transparent. Squashing all of that into a 32px tile leaves the mark as a
 * smudge in a mostly empty square. design-hub recorded exactly this failure at
 * nav size. So the icons crop to the lemon, which is a 604x602 near-square at
 * (660, 396), and composite it on the logo's own #ff4400 field, sampled from
 * the artwork rather than typed in.
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SRC = join(ROOT, 'design', 'logo.png');
const OUT = join(ROOT, 'site');

/** The logo's own dominant field colour, sampled from the artwork. */
const FIELD = '#ff4400';

/** The lemon, measured off the source. Square icons crop to this plus padding. */
const LEMON = { x: 660, y: 396, w: 604, h: 602 };

/** Lemon plus the DOORMAN wordmark, for the wide social card. */
const LOCKUP = { x: 372, y: 322, w: 1180, h: 858 };

/**
 * The whole composition, trimmed to its opaque bounds.
 *
 * Measured off the artwork: content runs x 372..1552, full height. The source
 * is 2000x2000 and 56.2% transparent, so shipping it as-is would send about
 * 40% of the bytes to move empty pixels around and leave the mark floating in
 * dead space inside its own box.
 */
const FULL = { x: 372, y: 0, w: 1180, h: 1996 };

const SQUARE = [
  ['favicon-16.png', 16],
  ['favicon-32.png', 32],
  ['favicon-180.png', 180],
  ['apple-touch-icon.png', 180],
  ['mark-256.png', 256],
];

const uri = 'data:image/png;base64,' + readFileSync(SRC).toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('about:blank');

const results = await page.evaluate(
  async ({ uri, FIELD, LEMON, LOCKUP, FULL, SQUARE }) => {
    const img = new Image();
    img.src = uri;
    await img.decode();

    const draw = (w, h, box, padRatio) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const x = c.getContext('2d');
      x.fillStyle = FIELD;
      x.fillRect(0, 0, w, h);

      const pad = Math.round(Math.min(w, h) * padRatio);
      const availW = w - pad * 2, availH = h - pad * 2;
      const scale = Math.min(availW / box.w, availH / box.h);
      const dw = box.w * scale, dh = box.h * scale;
      x.imageSmoothingQuality = 'high';
      x.drawImage(img, box.x, box.y, box.w, box.h,
                  (w - dw) / 2, (h - dh) / 2, dw, dh);
      return c.toDataURL('image/png');
    };

    const out = {};
    for (const [name, size] of SQUARE) {
      // Tighter padding on the tiny sizes: at 16px every pixel of margin is
      // 6% of the tile.
      out[name] = draw(size, size, LEMON, size <= 32 ? 0.04 : 0.10);
    }
    out['og.png'] = draw(1200, 630, LOCKUP, 0.09);

    /* The full logo keeps its own transparency: it sits on the page ground,
       not on an orange tile, so it must not carry a field with it. */
    const fw = 540, fh = Math.round(fw * (FULL.h / FULL.w));
    const fc = document.createElement('canvas');
    fc.width = fw; fc.height = fh;
    const fx = fc.getContext('2d');
    fx.imageSmoothingQuality = 'high';
    fx.drawImage(img, FULL.x, FULL.y, FULL.w, FULL.h, 0, 0, fw, fh);
    out['logo-full.png'] = fc.toDataURL('image/png');
    return out;
  },
  { uri, FIELD, LEMON, LOCKUP, FULL, SQUARE },
);

mkdirSync(OUT, { recursive: true });
for (const [name, dataUri] of Object.entries(results)) {
  const buf = Buffer.from(dataUri.split(',')[1], 'base64');
  writeFileSync(join(OUT, name), buf);
  console.log(`  ${name.padEnd(22)} ${String(buf.length).padStart(7)} bytes`);
}

await browser.close();
console.log('\n  Regenerate with: node scripts/make-icons.mjs');
