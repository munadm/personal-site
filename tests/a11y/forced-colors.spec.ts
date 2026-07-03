import { test, expect } from 'playwright/test';
import { ROUTES, routeId } from './_shared';

/*
 * Item 4 — forced colors.
 * Under emulateMedia({ forcedColors: 'active' }) every route must still render
 * readable text and distinguishable links, with no content rendered invisible
 * (e.g. text painted the same color as its background, or zero-opacity).
 */

test.use({ forcedColors: 'active' });

for (const route of ROUTES) {
  test(`forced-colors: ${routeId(route)} renders visible text and links`, async ({ page }) => {
    await page.goto(route);

    // The page has visible body text.
    const bodyText = (await page.locator('main').innerText()).trim();
    expect(bodyText.length).toBeGreaterThan(0);

    // The h1 is visible (non-zero box, not opacity:0 / display:none).
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible();
    const h1Box = await h1.boundingBox();
    expect(h1Box && h1Box.width > 0 && h1Box.height > 0).toBe(true);

    // Every in-page link is visible and has a non-transparent computed color.
    const linkStats = await page.locator('a:visible').evaluateAll((els) =>
      els.map((el) => {
        const cs = getComputedStyle(el as HTMLElement);
        return {
          color: cs.color,
          opacity: cs.opacity,
          display: cs.display,
          visibility: cs.visibility,
        };
      }),
    );
    expect(linkStats.length).toBeGreaterThan(0);
    for (const s of linkStats) {
      expect(s.display).not.toBe('none');
      expect(s.visibility).not.toBe('hidden');
      expect(Number(s.opacity)).toBeGreaterThan(0);
      // color:transparent would make link text invisible in forced colors.
      expect(s.color).not.toBe('rgba(0, 0, 0, 0)');
    }
  });
}
