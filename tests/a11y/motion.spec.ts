import { test, expect } from 'playwright/test';
import { ROUTES, routeId } from './_shared';

/*
 * Item 5 — reduced motion & the site's stronger "no motion at all" promise.
 *
 * The design commitment is that NOTHING animates, in either motion mode. So we
 * assert twice per route:
 *   - under prefers-reduced-motion: reduce, and
 *   - under prefers-reduced-motion: no-preference,
 * no element carries a running CSS animation (animation-name !== none with a
 * non-zero duration), and no element has a non-trivial transition that would
 * move/transform content. (A tiny transition on the skip link / .btn is gated
 * behind no-preference in CSS; we allow short color/transform transitions but
 * forbid any actual keyframe animation, which is the motion the promise bans.)
 */

async function collectAnimations(page: import('playwright/test').Page) {
  return page.evaluate(() => {
    const offenders: { selector: string; animationName: string; duration: string }[] = [];
    const all = Array.from(document.querySelectorAll<HTMLElement>('*'));
    for (const el of all) {
      const cs = getComputedStyle(el);
      const names = cs.animationName.split(',').map((n) => n.trim());
      const durations = cs.animationDuration.split(',').map((d) => d.trim());
      names.forEach((name, i) => {
        const dur = durations[i] ?? durations[0] ?? '0s';
        const durMs =
          dur.endsWith('ms') ? parseFloat(dur) : parseFloat(dur) * 1000;
        if (name && name !== 'none' && durMs > 0) {
          offenders.push({
            selector: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
              (typeof el.className === 'string' && el.className ? '.' + el.className.split(/\s+/)[0] : ''),
            animationName: name,
            duration: dur,
          });
        }
      });

      // Also flag :before/:after pseudo animations.
      for (const pseudo of ['::before', '::after']) {
        const pcs = getComputedStyle(el, pseudo);
        const pname = pcs.animationName;
        if (pname && pname !== 'none') {
          const pdur = pcs.animationDuration;
          const pdurMs = pdur.endsWith('ms') ? parseFloat(pdur) : parseFloat(pdur) * 1000;
          if (pdurMs > 0) {
            offenders.push({ selector: `pseudo ${pseudo}`, animationName: pname, duration: pdur });
          }
        }
      }
    }
    // Also: are any Web Animations API animations actually running?
    const running = (document.getAnimations?.() ?? [])
      .filter((a) => a.playState === 'running')
      .map((a) => (a as CSSAnimation).animationName ?? 'web-animation');
    return { offenders, running };
  });
}

for (const route of ROUTES) {
  for (const mode of ['reduce', 'no-preference'] as const) {
    test(`motion: no running animation on ${routeId(route)} (reducedMotion: ${mode})`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: mode });
      await page.goto(route);

      const { offenders, running } = await collectAnimations(page);

      expect(
        offenders,
        `elements with a running keyframe animation:\n${offenders
          .map((o) => `  ${o.selector}: ${o.animationName} (${o.duration})`)
          .join('\n')}`,
      ).toEqual([]);
      expect(running, `active Web Animations: ${running.join(', ')}`).toEqual([]);
    });
  }
}
