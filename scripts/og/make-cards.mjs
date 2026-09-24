/*
 * Build-time social card generator.
 *
 * For each page in the built site it reads the card's words from the HTML
 * (see card.mjs), renders the card in Chromium at 1200x630, and writes
 * public/og/<page>.png plus public/og/manifest.json, which Base.astro reads
 * to emit og:image, its size and its alt text. The PNGs are committed like
 * public/resume.pdf and the narration mp3s, so the deploy build never needs a
 * browser.
 *
 * Caching: each manifest entry stores a hash of the card's HTML. A run only
 * launches Chromium when a card's page (or the card design) actually changed,
 * so the pre-commit hook can call this on every commit and stay fast.
 *
 * Usage (from repo root):
 *   npm run cards                  # build the site, (re)render changed cards
 *   npm run cards -- --skip-build  # reuse dist/
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { chromium } from 'playwright';
import { HEIGHT, SELECTORS, WIDTH, cardAlt, cardHash, cardHtml, cardPath, cardText } from './card.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(ROOT, 'dist');
const PUBLIC = join(ROOT, 'public');
const MANIFEST = join(PUBLIC, 'og', 'manifest.json');
const FONT = join(
  ROOT,
  'node_modules/@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2',
);

/** Every built page as [route, html path], skipping asset folders. 404.html
 *  is not an index.html, so the not-found page shares the homepage card. */
function builtPages(dir = DIST, route = '') {
  const pages = [];
  if (existsSync(join(dir, 'index.html'))) pages.push([route || '/', join(dir, 'index.html')]);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    pages.push(...builtPages(join(dir, entry.name), `${route}/${entry.name}`));
  }
  return pages.sort(([a], [b]) => a.localeCompare(b));
}

/** The card for one built page: its words, HTML, hash and alt text. */
function planCard(route, htmlPath) {
  const { document } = new JSDOM(readFileSync(htmlPath, 'utf8')).window;
  const read = (selector) => document.querySelector(selector)?.textContent ?? '';
  const text = cardText({
    route,
    kicker: read(SELECTORS.kicker),
    title: read(SELECTORS.title),
    lede: read(SELECTORS.lede),
    documentTitle: document.title,
  });
  const html = cardHtml(route, text);
  return { route, html, hash: cardHash(html), image: cardPath(route), alt: cardAlt(text) };
}

const fontFace = () =>
  `@font-face { font-family: 'Archivo Card'; font-weight: 100 900; font-display: block;
  src: url(data:font/woff2;base64,${readFileSync(FONT).toString('base64')}) format('woff2'); }`;

async function render(browser, card) {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  try {
    await page.setContent(card.html.replace('/*FONT_FACE*/', fontFace()));
    const ready = await page.waitForFunction(() => document.body.dataset.ready);
    if ((await ready.jsonValue()) !== 'yes') {
      throw new Error(`${card.route}: Archivo did not load, refusing to render a fallback font`);
    }
    await page.screenshot({ path: join(PUBLIC, card.image), type: 'png' });
  } finally {
    await page.close();
  }
}

function writeManifest(manifest) {
  const ordered = {};
  for (const k of Object.keys(manifest).sort()) ordered[k] = manifest[k];
  writeFileSync(MANIFEST, `${JSON.stringify(ordered, null, 2)}\n`);
}

/** Drop cards whose page no longer exists, so a deleted page takes its image with it. */
function prune(manifest, routes) {
  for (const route of Object.keys(manifest)) {
    if (routes.has(route)) continue;
    rmSync(join(PUBLIC, manifest[route].image), { force: true });
    delete manifest[route];
    console.log(`✗ ${route} — page gone, card removed`);
  }
}

async function main() {
  if (!process.argv.includes('--skip-build')) {
    execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
  }
  if (!existsSync(DIST)) {
    console.error('No dist/ — run `npm run build` first or drop --skip-build.');
    process.exit(1);
  }
  mkdirSync(dirname(MANIFEST), { recursive: true });
  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};

  const cards = builtPages().map(([route, htmlPath]) => planCard(route, htmlPath));
  const stale = cards.filter(
    (c) => manifest[c.route]?.hash !== c.hash || !existsSync(join(PUBLIC, c.image)),
  );
  prune(manifest, new Set(cards.map((c) => c.route)));

  if (stale.length > 0) {
    const browser = await chromium.launch();
    try {
      for (const card of stale) {
        await render(browser, card);
        manifest[card.route] = { image: card.image, alt: card.alt, hash: card.hash };
        console.log(`● ${card.route} — rendered ${card.image}`);
      }
    } finally {
      await browser.close();
    }
  }
  writeManifest(manifest);
  console.log(stale.length ? `Rendered ${stale.length} card(s).` : 'All social cards up to date.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
