/*
 * Self-check for the read-along cue measurement.
 *
 * A wrong cue is silent in the worst way: the audio still plays, and the
 * margin marker simply sits on the wrong paragraph for the rest of the
 * reading. The two properties that prevent it are pinned here:
 *   - a break is only a break when it is digital silence at least
 *     three-quarters of PARAGRAPH_GAP long, so a quiet breath inside a
 *     paragraph and the SENTENCE_GAP join inside a split paragraph both
 *     stay invisible;
 *   - a count that disagrees with the page throws rather than guessing.
 *
 * The last check encodes a synthetic narration with those exact hazards
 * through the real ffmpeg + libmp3lame path and measures it back. It needs
 * ffmpeg, which make-audio already requires; without it that check says it
 * was skipped instead of passing quietly. tests/a11y/read-along.spec.ts
 * separately decodes the shipped mp3s in the browser and checks the committed
 * cues against them, so CI covers the real files either way.
 *
 * Run: node scripts/audio/test-cues.mjs
 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cuesFromSilences, hasCues, measureCues, minBreakSeconds, parseSilenceEnds } from './cues.mjs';
import { PARAGRAPH_GAP, SENTENCE_GAP } from './make-audio.mjs';

// The detection window sits strictly between the two joins make-audio writes.
{
  const floor = minBreakSeconds(PARAGRAPH_GAP);
  assert.ok(floor < PARAGRAPH_GAP, 'a real paragraph gap must clear the floor');
  assert.ok(floor > SENTENCE_GAP, 'a sentence join inside a split paragraph must not');
}

// silencedetect's log is parsed in order, ignoring silence_start lines.
{
  const log = [
    '[silencedetect @ 0x1] silence_start: 3.2',
    '[silencedetect @ 0x1] silence_end: 4.65 | silence_duration: 0.81',
    'size=N/A time=00:00:10.00 bitrate=N/A',
    '[silencedetect @ 0x1] silence_start: 32.6',
    '[silencedetect @ 0x1] silence_end: 33.4514 | silence_duration: 0.89',
  ].join('\n');
  assert.deepEqual(parseSilenceEnds(log), [4.65, 33.4514]);
}

// The first block starts at zero; the rest start where their silence ends.
{
  assert.deepEqual(cuesFromSilences([4.6512, 33.4514], 3), [0, 4.65, 33.45]);
  assert.deepEqual(cuesFromSilences([], 1), [0], 'a one-block page has one cue');
}

// A mismatch throws, in both directions, rather than shipping a drifting marker.
{
  assert.throws(() => cuesFromSilences([4.6], 3), /found 1 paragraph breaks for 3 blocks/);
  assert.throws(() => cuesFromSilences([4.6, 9.1, 12.2], 3), /found 3 paragraph breaks/);
}

// hasCues accepts only a list with one cue per block.
{
  assert.equal(hasCues({ cues: [0, 4, 9] }, 3), true);
  assert.equal(hasCues({ cues: [0, 4] }, 3), false);
  assert.equal(hasCues({ minutes: 4 }, 3), false);
  assert.equal(hasCues(undefined, 3), false);
}

/*
 * End to end through a real encode. Three "paragraphs" of tone, where:
 *   - paragraph 1 holds a full second of -60 dB breath, longer than any
 *     paragraph gap, which must NOT register because it is not digital silence;
 *   - paragraph 2 was split to fit the request cap, so it contains a
 *     SENTENCE_GAP join of true silence, which must NOT register either;
 *   - the paragraphs are joined with PARAGRAPH_GAP of true silence, which must.
 */
const RATE = 24000;
const pcm16 = (samples) => Buffer.from(Int16Array.from(samples).buffer);
const tone = (seconds, amplitude) =>
  pcm16(
    Array.from({ length: Math.round(seconds * RATE) }, (_, i) =>
      Math.round(amplitude * Math.sin((2 * Math.PI * 220 * i) / RATE)),
    ),
  );
const silence = (seconds) => Buffer.alloc(Math.round(seconds * RATE) * 2);
const SPEECH = 8000;
const BREATH = 30; // about -60 dBFS: quiet, but far above the -80 dB floor

function syntheticNarration() {
  const paragraphs = [
    [tone(2, SPEECH), tone(1, BREATH), tone(2, SPEECH)],
    [tone(3, SPEECH), silence(SENTENCE_GAP), tone(3, SPEECH)],
    [tone(2, SPEECH)],
  ];
  const parts = [];
  const expected = [];
  let seconds = 0;
  const append = (piece) => {
    parts.push(piece);
    seconds += piece.length / 2 / RATE;
  };
  paragraphs.forEach((paragraph, i) => {
    if (i > 0) append(silence(PARAGRAPH_GAP));
    expected.push(seconds);
    paragraph.forEach(append);
  });
  return { pcm: Buffer.concat(parts), expected };
}

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
if (hasFfmpeg) {
  const dir = mkdtempSync(join(tmpdir(), 'cues-'));
  try {
    const { pcm, expected } = syntheticNarration();
    const mp3 = join(dir, 'synthetic.mp3');
    execFileSync(
      'ffmpeg',
      ['-y', '-f', 's16le', '-ar', String(RATE), '-ac', '1', '-i', 'pipe:0', '-codec:a', 'libmp3lame', '-b:a', '64k', mp3],
      { input: pcm, stdio: ['pipe', 'ignore', 'ignore'] },
    );
    const cues = measureCues(mp3, expected.length, PARAGRAPH_GAP);
    assert.equal(cues.length, expected.length);
    cues.forEach((cue, i) => {
      // One mp3 frame is 24 ms at this rate; allow a couple for encoder delay.
      assert.ok(
        Math.abs(cue - expected[i]) < 0.06,
        `cue ${i} measured at ${cue}s, expected ${expected[i].toFixed(2)}s`,
      );
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
} else {
  console.log('cue self-check: ffmpeg not on PATH, skipped the real-encode check');
}

console.log('cue self-check: all assertions passed');
