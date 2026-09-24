import { readFileSync } from 'node:fs';
import { test, expect } from 'playwright/test';
import type { Page } from 'playwright/test';
import { ROUTES, routeId } from './a11y/_shared';
import {
  HEIGHT,
  SELECTORS,
  WIDTH,
  cardAlt,
  cardHash,
  cardHtml,
  cardText,
} from '../scripts/og/card.mjs';

/*
 * Social cards.
 *
 * A link to this site unfurls into the card for that page. The suite holds
 * every route to:
 *   - a card rendered from the page as it reads today (the hash is recomputed
 *     from the served page, so a copy edit without `npm run cards` fails here
 *     rather than sharing a stale headline);
 *   - og:image and twitter:image pointing at a PNG that resolves at exactly
 *     1200x630, the size LinkedIn, Slack and X crop to;
 *   - alt text on the card that says what the card says.
 *
 * The 404 has no card of its own and shares the homepage's.
 */

type Card = { image: string; alt: string; hash: string };
const manifest: Record<string, Card> = JSON.parse(
  readFileSync(new URL('../public/og/manifest.json', import.meta.url), 'utf8'),
);

const CARDED = ROUTES.filter((route) => route !== '/404');

const meta = (page: Page, key: string) =>
  page.locator(`meta[property="${key}"], meta[name="${key}"]`).getAttribute('content');

/** The card text for the page as served, read with the generator's selectors. */
async function servedCardText(page: Page, route: string) {
  const read = async (selector: string) => {
    const el = page.locator(selector).first();
    return (await el.count()) ? ((await el.textContent()) ?? '') : '';
  };
  return cardText({
    route,
    kicker: await read(SELECTORS.kicker),
    title: await read(SELECTORS.title),
    lede: await read(SELECTORS.lede),
    documentTitle: await page.title(),
  });
}

/** Width and height from a PNG's IHDR chunk, which always leads the file. */
function pngSize(bytes: Buffer) {
  expect(bytes.subarray(1, 4).toString('latin1'), 'not a PNG').toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

for (const route of CARDED) {
  test(`social card: ${routeId(route)} matches the page as it reads today`, async ({ page }) => {
    await page.goto(route);
    const entry = manifest[route];
    expect(entry, `no card for ${route}: run \`npm run cards\``).toBeTruthy();
    const text = await servedCardText(page, route);
    expect(entry.hash, `the card for ${route} is stale: run \`npm run cards\``).toBe(
      cardHash(cardHtml(route, text)),
    );
    expect(entry.alt).toBe(cardAlt(text));
  });
}

for (const route of ROUTES) {
  test(`social card: ${routeId(route)} unfurls to a 1200x630 PNG with alt text`, async ({ page }) => {
    await page.goto(route);
    const entry = manifest[route] ?? manifest['/'];

    const image = await meta(page, 'og:image');
    expect(image).toBe(`https://munadmahinoor.com${entry.image}`);
    expect(await meta(page, 'twitter:image')).toBe(image);
    expect(await meta(page, 'og:image:width')).toBe(String(WIDTH));
    expect(await meta(page, 'og:image:height')).toBe(String(HEIGHT));
    expect(await meta(page, 'og:image:type')).toBe('image/png');

    const alt = await meta(page, 'og:image:alt');
    expect(alt, 'the card needs alt text').toBe(entry.alt);
    expect(alt?.length ?? 0).toBeGreaterThan(10);
    expect(await meta(page, 'twitter:image:alt')).toBe(alt);

    const res = await page.request.get(entry.image);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/image\/png/);
    const bytes = await res.body();
    expect(pngSize(bytes)).toEqual({ width: WIDTH, height: HEIGHT });
    // Unfurlers fetch these on every share; keep them light.
    expect(bytes.length).toBeLessThan(200 * 1024);
  });
}
