/*
 * Read-along cues: the second at which each narrated block starts in its mp3.
 *
 * make-audio joins paragraphs with PARAGRAPH_GAP of digital silence, literal
 * zero samples, and speech never drops that low. So the paragraph boundaries
 * can be found again in the encoded file: at -80 dB, ffmpeg's silencedetect
 * reports exactly one silence per boundary in every shipped narration, while
 * the voice's own pauses, even the long ones, stay above that floor. The mp3
 * is therefore the single source of cues, whether it was synthesized a minute
 * ago or committed before cues existed.
 *
 * The detection floor sits below PARAGRAPH_GAP but above SENTENCE_GAP, so the
 * shorter joins inside an over-long paragraph that was split to fit the TTS
 * request cap are not mistaken for paragraph breaks.
 *
 * A cue list is only returned when its length matches the page's block count
 * exactly. A near miss would mark the wrong paragraph for the rest of the
 * reading, which is worse than marking nothing, so it throws instead.
 */

import { spawnSync } from 'node:child_process';

const SILENCE_FLOOR_DB = -80;

/** Seconds of silence that count as a paragraph break, given the gap
 *  make-audio inserts there. The margin absorbs encoder smearing at the edges. */
export const minBreakSeconds = (paragraphGap) => paragraphGap * 0.75;

/** Every `silence_end` timestamp in ffmpeg's silencedetect log, in order. */
export function parseSilenceEnds(log) {
  return [...log.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
}

/**
 * Block start times from the silences between blocks. The first block starts
 * at zero; each later one starts where the silence before it ends. Rounded to
 * centiseconds, which is finer than any reader can perceive and keeps the
 * manifest diff readable.
 */
export function cuesFromSilences(silenceEnds, blockCount) {
  if (silenceEnds.length !== blockCount - 1) {
    throw new Error(
      `found ${silenceEnds.length} paragraph breaks for ${blockCount} blocks ` +
        `(expected ${blockCount - 1}). The mp3 and the page disagree, so no ` +
        'read-along cues were written. Regenerate the narration.',
    );
  }
  return [0, ...silenceEnds.map((s) => Math.round(s * 100) / 100)];
}

/** Measure the cues for one mp3. Needs ffmpeg on PATH. */
export function measureCues(mp3Path, blockCount, paragraphGap) {
  const filter = `silencedetect=noise=${SILENCE_FLOOR_DB}dB:d=${minBreakSeconds(paragraphGap)}`;
  const run = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-nostats', '-i', mp3Path, '-af', filter, '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  if (run.status !== 0) {
    throw new Error(`ffmpeg could not read ${mp3Path}: ${run.stderr.slice(-400)}`);
  }
  return cuesFromSilences(parseSilenceEnds(run.stderr), blockCount);
}

/** True when an entry already carries one cue per block. */
export const hasCues = (entry, blockCount) =>
  Array.isArray(entry?.cues) && entry.cues.length === blockCount;
