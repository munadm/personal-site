import { test, expect } from 'playwright/test';
import AxeBuilder from '@axe-core/playwright';

/*
 * Fold / scroll-affordance regression suite.
 *
 * Owner requirement (2026-07 revision): on large phones the hero fills the
 * first screen — the hero's bottom boundary should land essentially AT the
 * fold on an iPhone 12 Pro Max (428x926). On a small phone (iPhone SE,
 * 375x667) the hero motif may dip below the fold, but at least 80% of the
 * motif's own height must remain visible above the fold. This supersedes
 * the earlier "hero bottom <=85% + next section peeks" rule on mobile.
 * Desktop is unaffected and keeps the hero filling a substantial portion
 * of the viewport.
 */

const LARGE_PHONE = { name: 'iPhone 12 Pro Max', width: 428, height: 926 };
const SMALL_PHONE = { name: 'iPhone SE', width: 375, height: 667 };
const DESKTOP_VIEWPORT = { name: 'Desktop', width: 1280, height: 800 };

test.describe(`hero fold @ ${LARGE_PHONE.name} (${LARGE_PHONE.width}x${LARGE_PHONE.height})`, () => {
  test.use({ viewport: { width: LARGE_PHONE.width, height: LARGE_PHONE.height } });

  test('hero bottom lands essentially at the fold', async ({ page }) => {
    await page.goto('/');

    const heroBox = await page.locator('.hero').boundingBox();
    expect(heroBox).not.toBeNull();

    const heroBottom = heroBox!.y + heroBox!.height;

    // Owner target: hero border "just at the fold" on a large phone —
    // bottom boundary between 90% and 102% of the viewport height.
    expect(heroBottom).toBeGreaterThanOrEqual(LARGE_PHONE.height * 0.9);
    expect(heroBottom).toBeLessThanOrEqual(LARGE_PHONE.height * 1.02);
  });

  test('no horizontal scrollbar (WCAG reflow check)', async ({ page }) => {
    await page.goto('/');

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.scrollingElement!.scrollWidth,
      clientWidth: document.scrollingElement!.clientWidth,
    }));

    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test('no axe violations', async ({ page }) => {
    await page.goto('/');

    const results = await new AxeBuilder({ page }).analyze();

    expect(results.violations).toEqual([]);
  });
});

test.describe(`hero fold @ ${SMALL_PHONE.name} (${SMALL_PHONE.width}x${SMALL_PHONE.height})`, () => {
  test.use({ viewport: { width: SMALL_PHONE.width, height: SMALL_PHONE.height } });

  test('at least 80% of the hero motif is visible above the fold', async ({ page }) => {
    await page.goto('/');

    const motifBox = await page.locator('.hero__motif').boundingBox();
    expect(motifBox).not.toBeNull();

    // The motif may dip below the fold on a small phone, but no more than
    // 20% of its own height may be hidden.
    const visibleFraction = (SMALL_PHONE.height - motifBox!.y) / motifBox!.height;
    expect(visibleFraction).toBeGreaterThanOrEqual(0.8);
  });

  test('no horizontal scrollbar (WCAG reflow check)', async ({ page }) => {
    await page.goto('/');

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.scrollingElement!.scrollWidth,
      clientWidth: document.scrollingElement!.clientWidth,
    }));

    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test('no axe violations', async ({ page }) => {
    await page.goto('/');

    const results = await new AxeBuilder({ page }).analyze();

    expect(results.violations).toEqual([]);
  });
});

test.describe(`desktop hero @ ${DESKTOP_VIEWPORT.name} (${DESKTOP_VIEWPORT.width}x${DESKTOP_VIEWPORT.height})`, () => {
  test.use({ viewport: { width: DESKTOP_VIEWPORT.width, height: DESKTOP_VIEWPORT.height } });

  test('hero still fills a substantial portion of the viewport', async ({ page }) => {
    await page.goto('/');

    const hero = page.locator('.hero');
    const heroBox = await hero.boundingBox();

    expect(heroBox).not.toBeNull();
    expect(heroBox!.y + heroBox!.height).toBeGreaterThan(DESKTOP_VIEWPORT.height * 0.5);
  });

  test('no horizontal scrollbar', async ({ page }) => {
    await page.goto('/');

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.scrollingElement!.scrollWidth,
      clientWidth: document.scrollingElement!.clientWidth,
    }));

    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
});
