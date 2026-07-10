/*
 * LAUNCH GATE — real VoiceOver narration of the homepage.
 *
 * This spec drives ACTUAL macOS VoiceOver via @guidepup/playwright. It is NOT
 * part of the default `npx playwright test` run:
 *   - playwright.config.ts's top-level `testIgnore` excludes tests/voiceover/**;
 *   - it only executes under the dedicated `voiceover` project, selected with
 *       npx playwright test --project=voiceover
 *
 * Requirements to run:
 *   - macOS.
 *   - VoiceOver automation permission granted once locally via `npx guidepup setup`
 *     (grants control of VoiceOver + the terminal running the tests). See
 *     https://www.guidepup.dev/docs/setup
 *   - In CI, use the official guidepup/setup-action step (see
 *     .github/workflows/voiceover-gate.yml) instead of running `guidepup setup`.
 *
 * It is a *launch* gate (run on release tags / manual dispatch), not a PR gate,
 * because real VoiceOver control is macOS-only and comparatively slow/flaky vs.
 * the jsdom virtual-screen-reader coverage in tests/a11y that runs on every PR.
 */

// @guidepup/playwright ships as CommonJS and exports `voiceOverTest` (a
// Playwright test extended with the VoiceOver fixture) but NOT `expect`.
// Import the default and destructure the test so it loads cleanly under
// Playwright's ESM/TS loader; take `expect` from Playwright, as the rest of
// the suite does.
import { expect } from 'playwright/test';
import guidepup from '@guidepup/playwright';
const { voiceOverTest: test } = guidepup as unknown as {
  voiceOverTest: typeof import('@guidepup/playwright').voiceOverTest;
};

test.describe('VoiceOver — homepage narration (launch gate)', () => {
  test('announces skip link, landmarks, and the h1', async ({ page, voiceOver }) => {
    await page.goto('/', { waitUntil: 'load' });
    // Wait for the page to be ready before moving the screen reader in.
    // getByRole matches the <header>'s IMPLICIT banner role; a CSS attribute
    // selector like header[role="banner"] only matches an explicit role
    // attribute, which this site's header (correctly) doesn't set.
    await page.getByRole('banner').waitFor();

    // Move VoiceOver INTO the browser's web content. This is guidepup's
    // canonical helper: it activates the browser (brings it to front), focuses
    // the document, jumps to the start of the web content, and clears the log.
    // Without it, VoiceOver starts on the browser CHROME (toolbar/omnibox) and
    // narrates "Search", "pop up button", etc. — never the page — which is
    // exactly what the hand-rolled interact()+jumpToLeftEdge walk did.
    await voiceOver.navigateToWebContent();

    // Capture the current item too, in case the cursor starts on content.
    const phrases: string[] = [await voiceOver.itemText()];
    for (let i = 0; i < 14; i++) {
      await voiceOver.next();
      phrases.push(await voiceOver.lastSpokenPhrase());
    }

    const joined = phrases.join(' | ');
    // Stable, meaningful beats of SEQUENTIAL reading — not full-log equality.
    //
    // Deliberately NOT asserted here: the skip link. It is hidden off-viewport
    // (transform: translateY(-200%)) until :focus, and real VoiceOver skips
    // offscreen elements during sequential reading BY DESIGN — confirmed
    // deterministically across CI runs. That is correct behavior, not a
    // defect: a skip link is a focus-activated control, reached via Tab, and
    // that interaction is covered on every commit by tests/a11y/keyboard.spec.ts
    // ("first Tab reveals the skip link", "skip link jumps to #main") plus the
    // virtual SR content checks in tests/a11y/virtual-screen-reader.spec.ts.
    //
    // These beats are mirrored by the fast local pre-flight in
    // tests/a11y/virtual-screen-reader.spec.ts ("mirrors the VoiceOver
    // launch-gate narration beats") — keep the two in sync (phrasing differs:
    // VoiceOver says "link Work", the virtual SR says "link, Work").
    expect(joined).toMatch(/banner/i); // header landmark
    expect(joined).toMatch(/Primary navigation/i); // nav landmark, by name
    expect(joined).toMatch(/link Work/i); // nav links narrated as links
    expect(joined).toMatch(/heading level 1[,]? Munad Mahinoor/i); // the h1
  });
});
