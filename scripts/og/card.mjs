/*
 * Social cards: the 1200x630 image a link to this site unfurls into on
 * LinkedIn, Slack, X, iMessage and the rest.
 *
 * Every card is built from the page it represents, never retyped: the
 * kicker, the h1, and the first sentence of the lede, read from the built
 * HTML. The rule study on the right is the hero motif's family, seeded from
 * the route, so each page gets its own silhouette and a card is recognisably
 * this site's at thumbnail size.
 *
 * This module is pure: text in, HTML and a hash out. make-cards.mjs owns the
 * browser and the files, and tests/social-cards.spec.ts imports the same
 * functions to prove every committed card still matches its page.
 */

import { createHash } from 'node:crypto';

export const WIDTH = 1200;
export const HEIGHT = 630;
export const SITE_NAME = 'Munad Mahinoor';
export const DOMAIN = 'munadmahinoor.com';

/*
 * Where a card's words come from on the page. Shared with the test, which
 * reads the same selectors from the served page.
 */
export const SELECTORS = {
  kicker: 'main .page-intro .kicker',
  title: 'main h1',
  // The resume has no lede, so its summary paragraph stands in.
  lede: 'main .hero__subhead, main .page-intro__lede, main .resume__section > p',
};

/* The site's light palette, from src/styles/tokens.css. */
const INK = '#16150f';
const BG = '#faf9f5';
const MUTED = '#55534a';
const ACCENT = '#0f6e56';

export const clean = (text) => (text ?? '').replace(/\s+/g, ' ').trim();

/** The lede's first sentence: enough to say what a short-titled page is. */
export function firstSentence(text) {
  const match = /^.*?[.!?](?=\s|$)/.exec(clean(text));
  return match ? match[0] : clean(text);
}

/**
 * The words on a card. The kicker is the page's own kicker when it has one
 * ("Case study 02"). The resume's h1 is the site name, so its kicker comes
 * from the document title ("Resume") to say which page this is. Other pages
 * go without: the footer already names the site. The homepage keeps its whole
 * subhead; everywhere else the lede is cut to its first sentence.
 */
export function cardText({ route, kicker, title, lede, documentTitle }) {
  const h1 = clean(title);
  const fromTitle = clean(documentTitle.replace(SITE_NAME, '').replace(/^[\s:—–|-]+|[\s:—–|-]+$/g, ''));
  const label = clean(kicker) || (h1 === SITE_NAME && route !== '/' ? fromTitle : '');
  const dek = route === '/' ? clean(lede) : firstSentence(lede);
  return { kicker: label, title: h1, dek };
}

/** Alt text for the card: the words it shows, in reading order. */
export function cardAlt({ kicker, title, dek }) {
  const lead = kicker ? `${kicker}: ${title}` : title;
  const parts = [lead, dek, title === SITE_NAME ? DOMAIN : `${SITE_NAME}, ${DOMAIN}`];
  return parts
    .filter(Boolean)
    .map((p) => (/[.!?]$/.test(p) ? p : `${p}.`))
    .join(' ');
}

/** Stable per-route seed, so a card only changes when its page does. */
function seedFor(route) {
  return createHash('sha256').update(route).digest().readUInt32LE(0);
}

/** mulberry32: small, fast, and identical on every machine. */
function random(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (n) => Math.round(n * 100) / 100;

/**
 * The rule study: horizontal rules whose weight swells along the block, with
 * the gap growing alongside so it never tightens into a uniform stripe (the
 * same rule HeroRules.astro follows). The left edge follows a slow curve, the
 * right edge bleeds off the card, and one rule carries the accent.
 */
export function motif(route) {
  const next = random(seedFor(route));
  const rows = 22 + Math.floor(next() * 7);
  const power = 1.6 + next() * 1.2;
  const maxWeight = 6 + next() * 4;
  const swellsDown = next() < 0.5;
  const phase = next() * Math.PI * 2;
  const accentPick = next();

  const x0 = 800;
  const top = 64;
  const bottom = HEIGHT - 64;
  const raw = [];
  let y = 0;
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1);
    const swell = (swellsDown ? t : 1 - t) ** power;
    const weight = 1 + swell * (maxWeight - 1);
    raw.push({ y: y + weight / 2, weight, t });
    y += weight + 7 + swell * 7;
  }
  const scale = (bottom - top) / y;
  // The accent goes on a rule with some body, never a hairline, so it reads
  // at thumbnail size.
  const bodied = raw.flatMap((r, i) => (r.weight >= 0.45 * maxWeight ? [i] : []));
  const accentRow = bodied[Math.floor(accentPick * bodied.length)];

  const lines = raw.map((r, i) => {
    const inset = 40 + 70 * (0.5 + 0.5 * Math.sin(phase + r.t * Math.PI * 1.3));
    const color = i === accentRow ? ACCENT : INK;
    return `<line x1="${round(x0 + inset)}" y1="${round(top + r.y * scale)}" x2="${WIDTH}" y2="${round(top + r.y * scale)}" stroke="${color}" stroke-width="${round(r.weight * scale)}"/>`;
  });
  return `<svg class="motif" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" aria-hidden="true">${lines.join('')}</svg>`;
}

/* RuleLogo.astro, inline: a square of rules of increasing weight. */
const LOGO = `<svg class="logo" viewBox="0 0 32 32" width="40" height="40" aria-hidden="true"><rect x="0.75" y="0.75" width="30.5" height="30.5" fill="none" stroke="${INK}" stroke-width="1.5"/><g stroke="${INK}"><line x1="6" y1="8" x2="26" y2="8" stroke-width="1"/><line x1="6" y1="14" x2="26" y2="14" stroke-width="2"/><line x1="6" y1="21" x2="26" y2="21" stroke-width="3"/><line x1="6" y1="27" x2="26" y2="27" stroke-width="4.5"/></g></svg>`;

const escape = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The card as a self-contained HTML page. FONT_FACE is a placeholder the
 * renderer swaps for the embedded Archivo, so the hash covers the layout
 * without depending on the font's bytes.
 */
export function cardHtml(route, { kicker, title, dek }) {
  const footName = title === SITE_NAME ? '' : `<span class="name">${SITE_NAME}</span>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
/*FONT_FACE*/
* { box-sizing: border-box; }
html, body { margin: 0; }
body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; position: relative;
  background: ${BG}; color: ${INK}; font-family: 'Archivo Card', sans-serif;
  -webkit-font-smoothing: antialiased; }
.motif { position: absolute; inset: 0; }
.text { position: absolute; left: 80px; top: 64px; bottom: 64px; width: 660px;
  display: flex; flex-direction: column; }
.kicker { margin: 0 0 28px; font-size: 22px; font-weight: 720; letter-spacing: 0.14em;
  text-transform: uppercase; color: ${MUTED}; }
.fit { flex: 1 1 auto; min-height: 0; }
.title { margin: 0; font-weight: 860; letter-spacing: -0.02em; line-height: 1.04;
  font-size: 96px; text-wrap: balance; }
.dek { margin: 24px 0 0; font-size: 30px; line-height: 1.3; font-weight: 420; color: ${MUTED};
  text-wrap: pretty; }
.foot { display: flex; align-items: center; gap: 16px; margin-top: 28px; font-size: 24px; }
.name { font-weight: 720; }
.domain { color: ${MUTED}; }
.stripe { position: absolute; left: 0; right: 0; bottom: 0; height: 12px; opacity: 0.6;
  background: repeating-linear-gradient(-45deg, ${MUTED} 0 2px, transparent 2px 6px); }
</style></head><body>
${motif(route)}
<div class="text">
${kicker ? `<p class="kicker">${escape(kicker)}</p>` : ''}
<div class="fit"><h1 class="title">${escape(title)}</h1>${dek ? `<p class="dek">${escape(dek)}</p>` : ''}</div>
<div class="foot">${LOGO}${footName}<span class="domain">${DOMAIN}</span></div>
</div>
<div class="stripe"></div>
<script>
  // Fit the title to the space the kicker, dek and footer leave, largest
  // size first, once the real font is in. The renderer waits for data-ready.
  document.fonts.ready.then(() => {
    const fit = document.querySelector('.fit');
    const title = document.querySelector('.title');
    let size = 96;
    while (fit.scrollHeight > fit.clientHeight && size > 40) {
      size -= 2;
      title.style.fontSize = size + 'px';
    }
    const loaded = document.fonts.check("860 48px 'Archivo Card'");
    document.body.dataset.ready = loaded ? 'yes' : 'font-missing';
  });
</script>
</body></html>`;
}

/** Hash of everything that changes the pixels except the font file. */
export const cardHash = (html) => createHash('sha256').update(html).digest('hex').slice(0, 16);

/** A route's card file, e.g. /work/bnpl-platform -> /og/work-bnpl-platform.png */
export const cardPath = (route) =>
  `/og/${route === '/' ? 'home' : route.replace(/^\//, '').replace(/\//g, '-')}.png`;
