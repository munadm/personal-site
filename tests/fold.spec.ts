import { test, expect } from 'playwright/test';
import AxeBuilder from '@axe-core/playwright';

/*
 * Scroll-affordance regression suite.
 *
 * Owner requirement: on narrow (phone-width) viewports, the hero section
 * must not monopolize the entire first screen — the next section (the
 * striped divider / "Selected work" heading) needs to peek into view so
 * the page invites scrolling. Desktop is unaffected and should keep the
 * hero filling a substantial portion of the viewport.
 */

const MOBILE_VIEWPORTS = [
  { name: 'iPhone SE', width: 375, height: 667 },
  { name: 'iPhone 14ish', width: 390, height: 844 },
];

const DESKTOP_VIEWPORT = { name: 'Desktop', width: 1280, height: 800 };

for (const viewport of MOBILE_VIEWPORTS) {
  test.describe(`fold affordance @ ${viewport.name} (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('hero sits above the fold and the next section peeks', async ({ page }) => {
      await page.goto('/');

      const hero = page.locator('.hero');
      const nextSection = page.locator('#work');

      const heroBox = await hero.boundingBox();
      const nextBox = await nextSection.boundingBox();

      expect(heroBox).not.toBeNull();
      expect(nextBox).not.toBeNull();

      // Hero must be fully above the fold, with room to spare (owner target:
      // hero bottom lands at roughly <=85% of viewport height).
      expect(heroBox!.y + heroBox!.height).toBeLessThan(viewport.height);
      expect(heroBox!.y + heroBox!.height).toBeLessThanOrEqual(viewport.height * 0.85);

      // The next section's top edge must already be visible within the
      // initial viewport, so the page visibly invites scrolling.
      expect(nextBox!.y).toBeLessThan(viewport.height);
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
}

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
