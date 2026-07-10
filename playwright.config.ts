import { defineConfig } from 'playwright/test';

/*
 * Playwright config for the personal site.
 *
 * The default `test` run covers the fold-affordance suite (tests/fold.spec.ts)
 * and the accessibility harness (tests/a11y/*.spec.ts). Both build the static
 * site once and preview it on :4321 via the shared webServer block below.
 *
 * The `voiceover` project (tests/voiceover/*.voiceover.spec.ts) is a launch
 * gate that drives REAL VoiceOver via @guidepup/playwright. It requires macOS
 * with `guidepup setup` run once locally (or the guidepup GitHub Action in CI)
 * to grant screen-reader control. It is deliberately EXCLUDED from the default
 * run — see testIgnore below — and is invoked explicitly with
 *   npx playwright test --project=voiceover
 * only in the voiceover-gate.yml workflow / on a properly configured Mac.
 */

const isCI = !!process.env.CI;

// The VoiceOver launch gate is opt-in. It drives REAL macOS VoiceOver and
// needs `guidepup setup` (or the guidepup GitHub Action) to grant control, so
// it is registered as a project ONLY when explicitly requested via env flag —
// keeping it out of the default `npx playwright test` run and out of PR CI.
//   VOICEOVER=1 npx playwright test --project=voiceover
const includeVoiceOver = !!process.env.VOICEOVER;

export default defineConfig({
  testDir: './tests',
  // Default run never touches the VoiceOver gate files.
  testIgnore: includeVoiceOver ? [] : ['**/voiceover/**'],
  fullyParallel: true,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:4321',
  },
  projects: [
    {
      // Default run: fold suite + a11y harness. Excludes the VoiceOver gate.
      name: 'a11y',
      testIgnore: ['**/voiceover/**'],
    },
    // Launch gate — only registered when VOICEOVER=1. Select explicitly:
    //   VOICEOVER=1 npx playwright test --project=voiceover
    ...(includeVoiceOver
      ? [
          {
            name: 'voiceover',
            testDir: './tests/voiceover',
            testMatch: ['**/*.voiceover.spec.ts'],
            // VoiceOver narrates the REAL on-screen browser window via the
            // macOS accessibility tree, so the browser must be headed — a
            // headless browser has no window to read and every spoken phrase
            // comes back empty. This is a hard guidepup requirement.
            use: { headless: false },
          },
        ]
      : []),
  ],
  webServer: {
    // Build the static site, then preview it. Mirrors the pre-existing pattern
    // (fold.spec.ts already relied on `npm run preview` on :4321); we prepend a
    // build so a fresh checkout/CI has dist/ before preview serves it.
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4321',
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
