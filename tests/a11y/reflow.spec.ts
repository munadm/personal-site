import { test, expect } from 'playwright/test';
import { ROUTES, routeId } from './_shared';

/*
 * Item 6 — reflow (WCAG 2.2 SC 1.4.10).
 * At a 320px-wide viewport, no route may require horizontal scrolling, and no
 * element may overflow the viewport width (which would clip or push content
 * off-screen). Height 1024 is the standard 1.4.10 test viewport.
 */

test.use({ viewport: { width: 320, height: 1024 } });

for (const route of ROUTES) {
  test(`reflow: ${routeId(route)} has no horizontal scroll at 320px`, async ({ page }) => {
    await page.goto(route);

    const scrollWidth = await page.evaluate(
      () => document.scrollingElement!.scrollWidth,
    );
    expect(scrollWidth, 'document should not scroll horizontally at 320px').toBeLessThanOrEqual(320);

    // No individual element should exceed the viewport width (allow 1px for
    // sub-pixel rounding). This catches clipped/overflowing text containers
    // that don't themselves create a document-level scrollbar.
    const overflow = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue; // hidden
        if (rect.right > 321 || rect.left < -1) {
          bad.push(
            el.tagName.toLowerCase() +
              (el.id ? '#' + el.id : '') +
              (typeof el.className === 'string' && el.className
                ? '.' + el.className.split(/\s+/)[0]
                : '') +
              ` [left=${Math.round(rect.left)}, right=${Math.round(rect.right)}]`,
          );
        }
      }
      return bad;
    });
    expect(overflow, `overflowing elements:\n${overflow.join('\n')}`).toEqual([]);
  });
}
