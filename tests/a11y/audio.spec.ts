import { readFileSync } from 'node:fs';
import { test, expect } from 'playwright/test';

/*
 * Audio narration (WS7).
 * Every page that ships an AI-narrated reading must expose it accessibly:
 *   - a single native <audio controls> element (keyboard + SR operable);
 *   - a non-empty accessible name describing what it plays;
 *   - a visible, honest "AI-narrated" label (no dark-patterning synthetic
 *     voice as human);
 *   - an mp3 that actually resolves, at a sane size for the CDN.
 *
 * The narrated routes are read from the generated manifest, so this suite
 * automatically covers any page `npm run audio` produces — add a page to the
 * generator and it is enforced here with no test edit.
 */

type Entry = { route: string; minutes: number; bytes: number };
const manifest: Record<string, Entry> = JSON.parse(
  readFileSync(new URL('../../public/audio/manifest.json', import.meta.url), 'utf8'),
);
const NARRATED = Object.entries(manifest).map(([slug, e]) => ({ slug, ...e }));

test('the audio manifest is not empty (narrations were generated)', () => {
  expect(NARRATED.length, 'run `npm run audio` to generate narrations').toBeGreaterThan(0);
});

for (const { slug, route, minutes } of NARRATED) {
  test(`audio: ${slug} exposes one accessible native player`, async ({ page }) => {
    await page.goto(route);
    const audio = page.locator('audio');
    await expect(audio).toHaveCount(1);
    // Native controls keep it keyboard- and screen-reader-operable for free.
    await expect(audio).toHaveAttribute('controls', '');
    // Don't ship the model on the CDN's dime for readers who never press play.
    await expect(audio).toHaveAttribute('preload', 'none');
    const name = await audio.getAttribute('aria-label');
    expect(name, 'audio needs a non-empty accessible name').toBeTruthy();
    expect(name).toMatch(/AI-narrated reading of this page/i);
  });

  test(`audio: ${slug} is labelled AI-narrated in visible text`, async ({ page }) => {
    await page.goto(route);
    await expect(page.getByText('AI-narrated', { exact: true })).toBeVisible();
    await expect(page.getByText(`${minutes} min`)).toBeVisible();
  });

  test(`audio: ${slug} mp3 resolves and is CDN-sized`, async ({ page }) => {
    const res = await page.request.get(`/audio/${slug}.mp3`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/audio\/(mpeg|mp3)/);
    const bytes = Number(res.headers()['content-length'] ?? 0);
    // Cloudflare Pages rejects files over 25MB; stay far clear.
    expect(bytes).toBeGreaterThan(1024);
    expect(bytes).toBeLessThan(20 * 1024 * 1024);
  });
}
