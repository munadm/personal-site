import { test, expect } from 'playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { virtual } from '@guidepup/virtual-screen-reader';

/*
 * Item 8 — virtual screen reader.
 * Drive @guidepup/virtual-screen-reader over the *built* static HTML (loaded
 * into jsdom) and assert the spoken-phrase log contains the key narration
 * beats, in order. We assert on stable, meaningful substrings (landmark
 * announcements, the h1, link names) rather than brittle full-log equality,
 * so copy tweaks don't break the suite but the accessible narration structure
 * stays locked.
 *
 * This runs in Node against dist/ (which the webServer step builds), so it does
 * not depend on the Playwright browser context.
 */

const distFor = (route: string) => {
  const rel = route === '/' ? 'index.html' : `${route.replace(/^\//, '')}/index.html`;
  return fileURLToPath(new URL(`../../dist/${rel}`, import.meta.url));
};

/** Run the virtual SR over the built page and return the ordered spoken log. */
async function narrate(route: string, steps = 200): Promise<string[]> {
  const html = readFileSync(distFor(route), 'utf8');
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  const { window } = dom;

  // The virtual SR reads from the ambient globals.
  const g = globalThis as Record<string, unknown>;
  const saved = {
    window: g.window,
    document: g.document,
    Node: g.Node,
    NodeFilter: g.NodeFilter,
    getComputedStyle: g.getComputedStyle,
  };
  g.window = window;
  g.document = window.document;
  g.Node = window.Node;
  g.NodeFilter = window.NodeFilter;
  g.getComputedStyle = window.getComputedStyle.bind(window);

  try {
    await virtual.start({ container: window.document.body });
    for (let i = 0; i < steps; i++) {
      await virtual.next();
    }
    const log = await virtual.spokenPhraseLog();
    await virtual.stop();
    return log;
  } finally {
    Object.assign(g, saved);
    window.close();
  }
}

/**
 * Assert that `needles` appear in `log` in the given order (each match must
 * come at or after the previous match). Matches are substring or RegExp.
 */
function expectInOrder(log: string[], needles: (string | RegExp)[]) {
  let cursor = 0;
  for (const needle of needles) {
    const idx = log.findIndex((phrase, i) => {
      if (i < cursor) return false;
      return typeof needle === 'string' ? phrase.includes(needle) : needle.test(phrase);
    });
    expect(
      idx,
      `expected narration to include ${needle} at/after index ${cursor}. Log:\n${log
        .map((p, i) => `  ${i}: ${p}`)
        .join('\n')}`,
    ).toBeGreaterThanOrEqual(cursor);
    cursor = idx + 1;
  }
}

test('virtual SR narrates the home page landmarks and h1 in order', async () => {
  const log = await narrate('/');

  expectInOrder(log, [
    'link, Skip to main content', // skip link announced first
    'banner', // header landmark
    'navigation, Primary', // nav landmark
    'link, Work', // nav links announced as links with names
    'link, Writing',
    'link, Resume',
    'link, Contact',
    /button, Switch to (dark|light) mode/, // theme toggle as a button
    'main', // main landmark
    'heading, Munad Mahinoor, level 1', // the h1
    'contentinfo', // footer landmark
  ]);
});

/*
 * Local pre-flight mirror of the REAL VoiceOver launch gate
 * (tests/voiceover/homepage.voiceover.spec.ts). That gate drives macOS
 * VoiceOver and only runs in CI on a macOS runner (slow, macOS-bound). This
 * test asserts the SAME narration beats via the virtual screen reader in
 * jsdom — so it runs on every PR and pre-commit with no VoiceOver and no
 * permissions, failing locally FIRST before anyone spends a macOS CI run.
 * Keep the beats in sync with the gate spec (phrasing differs: VoiceOver says
 * "link Work" / "Primary navigation"; the virtual SR says "link, Work" /
 * "navigation, Primary").
 *
 * One deliberate difference: the skip link IS asserted here but NOT in the
 * real gate. It is offscreen until :focus, and real VoiceOver skips offscreen
 * elements during sequential reading by design; the virtual SR (no layout)
 * still proves the skip link's accessible content exists, and its real
 * interaction (Tab → visible → jumps to #main) is covered by keyboard.spec.ts.
 */
test('virtual SR mirrors the VoiceOver launch-gate narration beats (home)', async () => {
  const joined = (await narrate('/')).join(' | ');
  expect(joined).toMatch(/skip to main content/i); // content exists (gate: covered by keyboard.spec.ts instead)
  expect(joined).toMatch(/banner/i); // header landmark
  expect(joined).toMatch(/navigation, Primary/i); // nav landmark, by name
  expect(joined).toMatch(/link, Work/i); // nav links narrated as links
  expect(joined).toMatch(/heading, Munad Mahinoor, level 1/i); // the h1
});

test('virtual SR narrates the work page landmarks and h1 in order', async () => {
  const log = await narrate('/work');

  expectInOrder(log, [
    'link, Skip to main content',
    'banner',
    'navigation, Primary',
    /link, Work.*current page/, // current page marked via aria-current
    'main',
    /heading, .+, level 1/, // the h1 of /work
    'contentinfo',
  ]);
});
