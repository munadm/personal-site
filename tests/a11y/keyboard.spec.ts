import { test, expect } from 'playwright/test';
import { hasVisibleFocusIndicator } from './_shared';

/*
 * Item 2 — keyboard-only walkthrough.
 * On / and /resume: Tab from a fresh load and assert
 *  - first focus is the skip link, which becomes visible on focus and jumps
 *    to #main when activated;
 *  - the nav links and theme toggle are all reachable in DOM order;
 *  - every focused element paints a visible focus indicator;
 *  - Enter activates a link;
 *  - Tab eventually cycles past the last focusable element (no keyboard trap).
 */

const PAGES = ['/', '/resume'] as const;

// The header focusables in DOM order: skip link, brand, then nav links, then
// the theme toggle. (The skip link is the very first focusable in <body>.)
const EXPECTED_HEADER_ORDER = [
  { desc: 'skip link', match: (el: FocusInfo) => el.className.includes('skip-link') },
  { desc: 'brand/home link', match: (el: FocusInfo) => el.className.includes('brand') },
  { desc: 'Work nav link', match: (el: FocusInfo) => el.href?.endsWith('/work') ?? false },
  { desc: 'Writing nav link', match: (el: FocusInfo) => el.href?.endsWith('/writing') ?? false },
  { desc: 'Resume nav link', match: (el: FocusInfo) => el.href?.endsWith('/resume') ?? false },
  { desc: 'Contact nav link', match: (el: FocusInfo) => el.href?.endsWith('/contact') ?? false },
  { desc: 'theme toggle', match: (el: FocusInfo) => el.id === 'theme-toggle' },
];

interface FocusInfo {
  tag: string;
  id: string;
  className: string;
  href: string | null;
  text: string;
  outlineStyle: string;
  outlineWidth: string;
  boxShadow: string;
}

async function activeInfo(page: import('playwright/test').Page): Promise<FocusInfo> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) {
      return {
        tag: '',
        id: '',
        className: '',
        href: null,
        text: '',
        outlineStyle: 'none',
        outlineWidth: '0px',
        boxShadow: 'none',
      };
    }
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id,
      className: typeof el.className === 'string' ? el.className : '',
      href: el.getAttribute('href'),
      text: (el.textContent || '').trim().slice(0, 40),
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      boxShadow: cs.boxShadow,
    };
  });
}

for (const path of PAGES) {
  test(`keyboard: first Tab reveals the skip link on ${path}`, async ({ page }) => {
    // Skip the site's (reduced-motion-gated) reveal transition so the
    // final visible/retracted positions are read deterministically, not
    // mid-animation.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(path);
    // Ensure focus starts from the top of the document.
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());

    // Skip link should be visually retracted (translated above the viewport)
    // before focus — its top edge is negative.
    const before = await page.locator('.skip-link').evaluate((el) => el.getBoundingClientRect().top);
    expect(before).toBeLessThan(0);

    await page.keyboard.press('Tab');
    const first = await activeInfo(page);
    expect(first.className, 'first Tab must land on the skip link').toContain('skip-link');

    // On focus, the skip link must be visible (translated into the viewport).
    const after = await page.locator('.skip-link').evaluate((el) => el.getBoundingClientRect().top);
    expect(after).toBeGreaterThanOrEqual(0);

    // It must carry a visible focus indicator.
    expect(hasVisibleFocusIndicator(first)).toBe(true);
  });

  test(`keyboard: skip link jumps to #main on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp('#main$'));
    // #main exists and is the anchor target.
    await expect(page.locator('#main')).toHaveCount(1);
  });

  test(`keyboard: nav links + theme toggle reachable in DOM order on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());

    const seen: FocusInfo[] = [];
    // Tab through enough stops to cover the whole header chrome.
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      const info = await activeInfo(page);
      seen.push(info);
      // Every focused element must have a visible focus indicator.
      expect(
        hasVisibleFocusIndicator(info),
        `focused <${info.tag}${info.id ? '#' + info.id : ''}> "${info.text}" has no visible focus indicator`,
      ).toBe(true);
      // Stop once we've passed the theme toggle.
      if (info.id === 'theme-toggle') break;
    }

    // The expected header focusables must appear in the observed order.
    let cursor = 0;
    for (const expected of EXPECTED_HEADER_ORDER) {
      const idx = seen.findIndex((el, i) => i >= cursor && expected.match(el));
      expect(idx, `expected to focus ${expected.desc} after previous header stops`).toBeGreaterThanOrEqual(
        cursor === 0 ? 0 : cursor,
      );
      cursor = idx + 1;
    }
  });

  test(`keyboard: Enter activates a nav link on ${path}`, async ({ page }) => {
    await page.goto(path);
    // Focus the Work nav link directly and activate it.
    const work = page.locator('nav[aria-label="Primary"] a[href="/work"]');
    await work.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/work\/?$/);
  });

  test(`keyboard: no trap — Tab cycles past the last focusable on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());

    // Tab many times; the active element must change over time and eventually
    // return to <body> (focus leaves the document) rather than sticking on one
    // element — the signature of a keyboard trap.
    const ids = new Set<string>();
    let returnedToBody = false;
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const info = await activeInfo(page);
      const key = `${info.tag}#${info.id}.${info.className}[${info.href}]`;
      ids.add(key);
      if (info.tag === 'body' || info.tag === '') {
        returnedToBody = true;
        break;
      }
    }
    // We saw multiple distinct focusables (not stuck) ...
    expect(ids.size).toBeGreaterThan(3);
    // ... and focus eventually left the focusable set (cycled to body/address bar).
    expect(returnedToBody).toBe(true);
  });
}
