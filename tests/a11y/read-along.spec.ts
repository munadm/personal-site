import { readFileSync } from 'node:fs';
import { test, expect } from 'playwright/test';
import type { Locator, Page } from 'playwright/test';
import { NARRATED_BLOCKS } from '../../src/lib/narration.mjs';
import { minBreakSeconds } from '../../scripts/audio/cues.mjs';
import { PARAGRAPH_GAP } from '../../scripts/audio/make-audio.mjs';

/*
 * Read-along narration.
 *
 * While a case study's narration plays, the paragraph being spoken is marked
 * in the margin. The promises this suite holds it to:
 *   - there is one cue per narrated block, and each cue sits on a real
 *     paragraph break in the mp3, checked by decoding the shipped file in the
 *     browser that plays it (an independent check on scripts/audio/cues.mjs,
 *     which measured them with ffmpeg);
 *   - exactly one paragraph is marked at a time, the right one, and none once
 *     the reading ends;
 *   - marking changes nothing else: no layout shift, no scrolling, no motion,
 *     and an identical accessibility tree;
 *   - the marker survives forced colors and clears 3:1 non-text contrast in
 *     both themes;
 *   - the lock screen names the reading, and its previous and next buttons
 *     move a paragraph at a time;
 *   - readers can turn the marker off, or switch it to an outline, with
 *     native keyboard-operable controls that remember the choice;
 *   - without JavaScript the player is exactly what it was.
 *
 * Narrated routes come from the manifest, so a new case study is covered with
 * no edit here.
 */

type Entry = { route: string; cues: number[] };
const manifest: Record<string, Entry> = JSON.parse(
  readFileSync(new URL('../../public/audio/manifest.json', import.meta.url), 'utf8'),
);
const NARRATED = Object.entries(manifest).map(([slug, e]) => ({ slug, ...e }));

// -80 dBFS, the floor cues.mjs measures against: only inserted digital
// silence gets this quiet, never the voice.
const SILENCE_AMPLITUDE = 10 ** (-80 / 20);

const blocksOn = (page: Page) => page.locator(NARRATED_BLOCKS).filter({ hasText: /\S/ });
const marked = (page: Page) => page.locator('[data-narrating]');
const markerSwitch = (page: Page) => page.getByRole('switch', { name: 'Mark the paragraph being read' });
const styleRadio = (page: Page, name: 'Margin rule' | 'Outline') => page.getByRole('radio', { name });

/** How the marked paragraph is drawn: its outline, and its margin rule. */
const markerLook = (page: Page) =>
  marked(page).evaluate((el) => {
    const own = getComputedStyle(el);
    const rule = getComputedStyle(el, '::before');
    return {
      outlineStyle: own.outlineStyle,
      outlineWidth: own.outlineWidth,
      outlineColor: own.outlineColor,
      rule: rule.display !== 'none' && rule.content !== 'none',
    };
  });

/** Every line box of every narrated block: where the words actually sit. A
 *  block's own box can stay put while its text moves inside it. */
const lineBoxes = (page: Page) =>
  blocksOn(page).evaluateAll((els) =>
    els.map((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return Array.from(range.getClientRects(), (r) => r.toJSON());
    }),
  );

declare global {
  interface Window {
    recordMutation?: (entry: string) => void;
    mediaHandlers?: Partial<Record<MediaSessionAction, () => void>>;
  }
}

/** Keep a handle on every Media Session action the page registers, so a test
 *  can press the lock screen's buttons. Installed before the page loads. */
async function captureMediaHandlers(page: Page) {
  await page.addInitScript(() => {
    const handlers: Partial<Record<MediaSessionAction, () => void>> = {};
    window.mediaHandlers = handlers;
    const register = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
    navigator.mediaSession.setActionHandler = (action, handler) => {
      if (handler) handlers[action] = () => handler({ action });
      register(action, handler);
    };
  });
}

/** Press a lock-screen button and wait for the seek it causes. */
async function press(page: Page, action: MediaSessionAction) {
  await page.locator('audio').evaluate(
    (a: HTMLAudioElement, act) =>
      new Promise<void>((resolve) => {
        a.addEventListener('seeked', () => resolve(), { once: true });
        window.mediaHandlers?.[act]?.();
      }),
    action,
  );
}

/** Collect every DOM mutation from now on into a list on the test side, so a
 *  test can say exactly what the read-along touched. */
async function watchMutations(page: Page): Promise<string[]> {
  const seen: string[] = [];
  await page.exposeFunction('recordMutation', (entry: string) => seen.push(entry));
  await page.evaluate(() => {
    new MutationObserver((records) => {
      for (const r of records) {
        const where = r.target instanceof Element ? r.target.tagName.toLowerCase() : '#text';
        void window.recordMutation?.(
          r.type === 'attributes' ? `${where}[${r.attributeName}]` : `${where} ${r.type}`,
        );
      }
    }).observe(document, { subtree: true, attributes: true, childList: true, characterData: true });
  });
  return seen;
}

/** Start the media pipeline (muted, so headless autoplay allows it), then park. */
async function primePlayer(audio: Locator) {
  await audio.evaluate(async (a: HTMLAudioElement) => {
    a.muted = true;
    await a.play();
    a.pause();
  });
}

/** Seek and wait for the page's own seeked handler to have run. */
async function seek(audio: Locator, seconds: number) {
  await audio.evaluate(
    (a: HTMLAudioElement, t) =>
      new Promise<void>((resolve) => {
        a.addEventListener('seeked', () => resolve(), { once: true });
        a.currentTime = t;
      }),
    seconds,
  );
}

/** Where every long run of digital silence in the mp3 ends, decoded in-browser. */
async function decodedBreaks(page: Page, src: string, minRun: number) {
  return page.evaluate(
    async ({ src, floor, minRun }) => {
      const bytes = await (await fetch(src)).arrayBuffer();
      const decoded = await new OfflineAudioContext(1, 1, 24000).decodeAudioData(bytes);
      const data = decoded.getChannelData(0);
      const rate = decoded.sampleRate;
      const ends: number[] = [];
      let runStart = -1;
      for (let i = 0; i <= data.length; i++) {
        const quiet = i < data.length && Math.abs(data[i]) < floor;
        if (quiet && runStart < 0) runStart = i;
        if (quiet || runStart < 0) continue;
        // Runs touching either end of the file are lead-in or tail, not breaks.
        const interior = runStart > 0 && i < data.length;
        if (interior && (i - runStart) / rate >= minRun) ends.push(i / rate);
        runStart = -1;
      }
      return ends;
    },
    { src, floor: SILENCE_AMPLITUDE, minRun },
  );
}

/** WCAG relative luminance of a computed `rgb(...)` color. */
function luminance(rgb: string): number {
  const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => {
    const c = Number(v) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

for (const { slug, route, cues } of NARRATED) {
  test(`read-along: ${slug} has one cue per narrated block, in order`, async ({ page }) => {
    await page.goto(route);
    await expect(blocksOn(page)).toHaveCount(cues.length);
    expect(cues[0]).toBe(0);
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i], `cue ${i} must come after cue ${i - 1}`).toBeGreaterThan(cues[i - 1]);
    }
  });

  test(`read-along: ${slug} cues land on the paragraph breaks in the audio`, async ({ page }) => {
    await page.goto(route);
    const breaks = await decodedBreaks(page, `/audio/${slug}.mp3`, minBreakSeconds(PARAGRAPH_GAP));
    expect(breaks, 'every paragraph break in the mp3 needs a cue, and nothing else').toHaveLength(
      cues.length - 1,
    );
    breaks.forEach((end, i) => {
      // Decoders differ by an mp3 frame or two at the edges; a tenth of a
      // second is far below anything a reader could notice.
      expect(Math.abs(end - cues[i + 1]), `cue ${i + 1}`).toBeLessThan(0.1);
    });
  });

  test(`read-along: ${slug} marks the paragraph being spoken, and only that one`, async ({ page }) => {
    await page.goto(route);
    const audio = page.locator('audio');
    const blocks = blocksOn(page);
    await expect(marked(page)).toHaveCount(0);

    await primePlayer(audio);
    for (const i of [1, 3, cues.length - 1, 0]) {
      await seek(audio, cues[i] + 0.5);
      await expect(marked(page)).toHaveCount(1);
      await expect(blocks.nth(i)).toHaveAttribute('data-narrating', '');
    }

    // Pausing leaves the marker where the reader stopped.
    await seek(audio, cues[2] + 0.5);
    await expect(blocks.nth(2)).toHaveAttribute('data-narrating', '');

    // Playing through the end clears it.
    await audio.evaluate(
      (a: HTMLAudioElement) =>
        new Promise<void>((resolve) => {
          a.addEventListener('ended', () => resolve(), { once: true });
          a.currentTime = Math.max(0, a.duration - 0.3);
          void a.play();
        }),
    );
    await expect(marked(page)).toHaveCount(0);
  });

  test(`read-along: ${slug} marking moves nothing and animates nothing`, async ({ page }) => {
    await page.goto(route);
    const audio = page.locator('audio');
    const before = await lineBoxes(page);
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await primePlayer(audio);
    await seek(audio, cues[cues.length - 1] + 0.5);
    await expect(marked(page)).toHaveCount(1);

    expect(await lineBoxes(page), 'marking a paragraph must not move a single line').toEqual(before);
    expect(await page.evaluate(() => window.scrollY), 'the page is never scrolled for the reader').toBe(
      scrollBefore,
    );
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  });

  test(`read-along: ${slug} leaves the accessibility tree untouched`, async ({ page }) => {
    await page.goto(route);
    const main = page.getByRole('main');
    const atRest = await main.ariaSnapshot();
    const touched = await watchMutations(page);
    await primePlayer(page.locator('audio'));
    await seek(page.locator('audio'), cues[2] + 0.5);
    await seek(page.locator('audio'), cues[4] + 0.5);
    await expect(marked(page)).toHaveCount(1);
    await page.evaluate(() => 0); // let the last mutation reports land

    // The read-along's whole footprint is one data- attribute moving between
    // blocks (the heading when playback starts at zero, then paragraphs).
    // data-* is invisible to assistive technology by definition, so this rules
    // out any role, name, state or text change, including ones (aria-current,
    // say) that the ARIA snapshot below does not print.
    expect([...new Set(touched)].sort()).toEqual(['h1[data-narrating]', 'p[data-narrating]']);
    expect(await main.ariaSnapshot()).toBe(atRest);
  });

  test(`read-along: ${slug} names the reading on the lock screen`, async ({ page }) => {
    await page.goto(route);
    await primePlayer(page.locator('audio'));
    const metadata = await page.evaluate(() => {
      const m = navigator.mediaSession.metadata;
      return { title: m?.title, artist: m?.artist, artwork: m?.artwork.map((a) => a.src) };
    });
    expect(metadata.title).toBe((await page.locator('main h1').textContent())?.trim());
    expect(metadata.artist).toBe('Munad Mahinoor');
    const card = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect(metadata.artwork).toEqual([card]);
  });

  test(`read-along: ${slug} previous and next move a paragraph at a time`, async ({ page }) => {
    await captureMediaHandlers(page);
    await page.goto(route);
    const audio = page.locator('audio');
    const blocks = blocksOn(page);
    const at = () => audio.evaluate((a: HTMLAudioElement) => a.currentTime);
    await primePlayer(audio);

    await seek(audio, cues[2] + 0.5);
    await press(page, 'nexttrack');
    await expect(blocks.nth(3)).toHaveAttribute('data-narrating', '');
    expect(await at()).toBeCloseTo(cues[3], 1);

    // Right after a paragraph starts, "previous" goes back one...
    await press(page, 'previoustrack');
    await expect(blocks.nth(2)).toHaveAttribute('data-narrating', '');
    expect(await at()).toBeCloseTo(cues[2], 1);

    // ...but a few seconds in, it restarts the paragraph being read.
    await seek(audio, cues[4] + 5);
    await press(page, 'previoustrack');
    await expect(blocks.nth(4)).toHaveAttribute('data-narrating', '');
    expect(await at()).toBeCloseTo(cues[4], 1);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`read-along: ${slug} marker clears 3:1 non-text contrast (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(route);
      await primePlayer(page.locator('audio'));
      await seek(page.locator('audio'), cues[1] + 0.5);
      const colors = await marked(page).evaluate((el) => {
        const resolve = (token: string) => {
          const probe = document.createElement('span');
          probe.style.color = `var(${token})`;
          el.append(probe);
          const value = getComputedStyle(probe).color;
          probe.remove();
          return value;
        };
        return {
          rule: resolve('--color-accent-graphic'),
          outline: resolve('--color-accent-soft'),
          page: getComputedStyle(document.body).backgroundColor,
        };
      });
      // WCAG 1.4.11: graphics that convey state need 3:1 against what they sit on.
      expect(contrast(colors.rule, colors.page), 'margin rule').toBeGreaterThanOrEqual(3);
      expect(contrast(colors.outline, colors.page), 'outline').toBeGreaterThanOrEqual(3);
    });
  }

  test(`read-along: ${slug} marker stays visible under forced colors`, async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto(route);
    await primePlayer(page.locator('audio'));
    await seek(page.locator('audio'), cues[1] + 0.5);
    const marker = await marked(page).evaluate((el) => {
      const cs = getComputedStyle(el, '::before');
      return { image: cs.backgroundImage, width: cs.width, adjust: cs.forcedColorAdjust };
    });
    expect(marker.adjust).toBe('none');
    expect(marker.image).toContain('gradient');
    expect(parseFloat(marker.width)).toBeGreaterThan(0);

    await styleRadio(page, 'Outline').check();
    const outline = await markerLook(page);
    expect(outline.outlineStyle).toBe('solid');
    expect(outline.outlineColor).not.toBe('rgba(0, 0, 0, 0)');
  });

  test(`read-along: ${slug} switch turns the marker off and back on`, async ({ page }) => {
    await page.goto(route);
    const audio = page.locator('audio');
    const blocks = blocksOn(page);
    await expect(markerSwitch(page)).toBeChecked();
    await primePlayer(audio);
    await seek(audio, cues[3] + 0.5);
    await expect(blocks.nth(3)).toHaveAttribute('data-narrating', '');

    await markerSwitch(page).uncheck();
    await expect(marked(page)).toHaveCount(0);
    await seek(audio, cues[1] + 0.5);
    await expect(marked(page), 'off means off, through seeks and playback').toHaveCount(0);
    // The style choice has nothing to act on while the marker is off.
    await expect(styleRadio(page, 'Margin rule')).toBeDisabled();
    await expect(styleRadio(page, 'Outline')).toBeDisabled();

    await markerSwitch(page).check();
    await expect(blocks.nth(1), 'turning it back on marks where the voice is').toHaveAttribute(
      'data-narrating',
      '',
    );
    await expect(marked(page)).toHaveCount(1);
  });

  test(`read-along: ${slug} outline style replaces the rule without moving a line`, async ({ page }) => {
    await page.goto(route);
    const audio = page.locator('audio');
    const atRest = await lineBoxes(page);
    await primePlayer(audio);
    await seek(audio, cues[2] + 0.5);

    const rule = await markerLook(page);
    expect(rule.rule).toBe(true);
    expect(rule.outlineStyle).toBe('none');

    await styleRadio(page, 'Outline').check();
    const outline = await markerLook(page);
    expect(outline.rule, 'one marker at a time').toBe(false);
    expect(outline.outlineStyle).toBe('solid');
    expect(outline.outlineWidth).toBe('2px');
    expect(await lineBoxes(page), 'the outline must not move a single line').toEqual(atRest);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  });

  test(`read-along: ${slug} remembers the reader's choice`, async ({ page }) => {
    await page.goto(route);
    await styleRadio(page, 'Outline').check();
    await markerSwitch(page).uncheck();
    await page.reload();
    await expect(markerSwitch(page)).not.toBeChecked();
    await expect(styleRadio(page, 'Outline')).toBeChecked();

    await primePlayer(page.locator('audio'));
    await seek(page.locator('audio'), cues[2] + 0.5);
    await expect(marked(page)).toHaveCount(0);
    await markerSwitch(page).check();
    await page.reload();
    await expect(markerSwitch(page)).toBeChecked();
    await primePlayer(page.locator('audio'));
    await seek(page.locator('audio'), cues[2] + 0.5);
    expect((await markerLook(page)).outlineStyle).toBe('solid');
  });

  test(`read-along: ${slug} settings work from the keyboard`, async ({ page }) => {
    await page.goto(route);
    await markerSwitch(page).focus();
    await page.keyboard.press('Space');
    await expect(markerSwitch(page)).not.toBeChecked();
    await page.keyboard.press('Space');
    await expect(markerSwitch(page)).toBeChecked();

    await page.keyboard.press('Tab');
    await expect(styleRadio(page, 'Margin rule')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(styleRadio(page, 'Outline')).toBeChecked();
    await expect(styleRadio(page, 'Outline')).toBeFocused();
  });
}

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  for (const { slug, route } of NARRATED) {
    test(`read-along: ${slug} player works unchanged with no script`, async ({ page }) => {
      await page.goto(route);
      await expect(page.locator('audio[controls]')).toHaveCount(1);
      await expect(marked(page)).toHaveCount(0);
      // Settings that nothing would honour are never shown.
      await expect(page.locator('.read-along')).toBeHidden();
    });
  }
});
