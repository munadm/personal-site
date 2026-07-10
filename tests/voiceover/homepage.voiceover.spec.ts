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
    await page.locator('header[role="banner"]').waitFor();

    // Move VoiceOver INTO the browser's web content. This is guidepup's
    // canonical helper: it activates the browser (brings it to front), focuses
    // the document, jumps to the start of the web content, and clears the log.
    // Without it, VoiceOver starts on the browser CHROME (toolbar/omnibox) and
    // narrates "Search", "pop up button", etc. — never the page — which is
    // exactly what the hand-rolled interact()+jumpToLeftEdge walk did.
    await voiceOver.navigateToWebContent();

    const phrases: string[] = [];
    for (let i = 0; i < 14; i++) {
      await voiceOver.next();
      phrases.push(await voiceOver.lastSpokenPhrase());
    }

    const joined = phrases.join(' | ');
    // Stable, meaningful beats — not full-log equality.
    // These two patterns are mirrored by a fast, no-permissions local
    // pre-flight in tests/a11y/virtual-screen-reader.spec.ts ("mirrors the
    // VoiceOver launch-gate narration beats") that runs on every PR/pre-commit.
    // Keep them in sync: if you change these, update that test too.
    expect(joined).toMatch(/skip to main content/i);
    expect(joined).toMatch(/Munad Mahinoor/);
  });
});
