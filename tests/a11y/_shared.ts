import type { Page } from 'playwright/test';

/**
 * The eleven public, static routes the accessibility harness must enforce.
 * Excludes the /proto/* pages, which are unlinked prototypes and not part of
 * the shipped site surface.
 */
export const ROUTES = [
  '/',
  '/work',
  '/work/bnpl-platform',
  '/work/simplification-layer',
  '/work/llm-pii-scanner',
  '/writing',
  '/resume',
  '/contact',
  '/accessibility',
  '/colophon',
  '/404',
] as const;

export type Route = (typeof ROUTES)[number];

/**
 * A stable, human-readable id for a route, usable in test titles and
 * snapshot filenames.
 */
export function routeId(route: Route): string {
  return route === '/' ? 'home' : route.replace(/^\//, '').replace(/\//g, '-');
}

/**
 * Force an explicit theme via the same mechanism the site's toggle uses:
 * the [data-theme] attribute on <html>, mirrored into localStorage so a
 * reload would keep it. Applied before any scan so axe sees the real
 * rendered colors for that theme.
 *
 * Waits for any CSS transitions the flip triggers (e.g. .btn animates
 * background/color over 120ms) — otherwise a scan can read interpolated
 * mid-transition colors and report phantom contrast failures.
 */
export async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t);
    try {
      localStorage.setItem('theme', t);
    } catch {
      /* ignore */
    }
  }, theme);
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))),
  );
}

/**
 * True when the given computed CSS declares a visible focus indicator —
 * a non-none outline OR a box-shadow. Used to assert every focusable
 * element is keyboard-visible.
 */
export function hasVisibleFocusIndicator(style: {
  outlineStyle: string;
  outlineWidth: string;
  boxShadow: string;
}): boolean {
  const outlineVisible =
    style.outlineStyle !== 'none' &&
    style.outlineWidth !== '0px' &&
    style.outlineWidth !== '';
  const shadowVisible = style.boxShadow !== 'none' && style.boxShadow !== '';
  return outlineVisible || shadowVisible;
}
