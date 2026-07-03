import { test, expect } from 'playwright/test';
import { ROUTES, routeId } from './_shared';

/*
 * Item 7 — ARIA snapshots.
 * Lock the accessibility tree of each route's <main> landmark. Snapshots are
 * stored under __snapshots__/ next to this file (see -snapshots dir). Regenerate
 * intentionally with:  npx playwright test aria-snapshot --update-snapshots
 */

for (const route of ROUTES) {
  test(`aria snapshot: ${routeId(route)} main landmark`, async ({ page }) => {
    await page.goto(route);
    await expect(page.getByRole('main')).toMatchAriaSnapshot({
      name: `${routeId(route)}-main.aria.yml`,
    });
  });
}
