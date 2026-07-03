import { test, expect } from 'playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ROUTES, routeId, setTheme } from './_shared';

/*
 * Item 1 — axe scan.
 * Run @axe-core/playwright against every public route in BOTH light and dark
 * themes. Any violation fails. The WCAG 2.2 AA / AAA tags are engaged so axe
 * enforces the site's stated conformance target where it can detect it
 * (contrast, names, roles, landmarks, etc.).
 */

const THEMES = ['light', 'dark'] as const;

for (const route of ROUTES) {
  for (const theme of THEMES) {
    test(`axe: ${routeId(route)} (${theme})`, async ({ page }) => {
      await page.goto(route);
      await setTheme(page, theme);

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
        .analyze();

      expect(
        results.violations,
        results.violations.map((v) => `${v.id}: ${v.help}`).join('\n'),
      ).toEqual([]);
    });
  }
}
