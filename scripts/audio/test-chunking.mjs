/*
 * Self-check for the narration chunking logic.
 *
 * This is the part of make-audio.mjs that decides how prose reaches the TTS
 * API, and getting it wrong is silent: the audio still generates, it just goes
 * back to sounding like a list of unrelated sentences. The specific regression
 * this guards is normalizeForSpeech() collapsing the \n paragraph boundaries
 * that toChunks() splits on — one stray \s+ and every page becomes one chunk.
 *
 * Run: node scripts/audio/test-chunking.mjs
 */

import assert from 'node:assert/strict';
import {
  normalizeForSpeech,
  toChunks,
  countWords,
  estimateSeconds,
  SENTENCE_GAP,
  PARAGRAPH_GAP,
  MAX_CHUNK_SECONDS,
} from './make-audio.mjs';

// Paragraph boundaries survive normalization; horizontal runs collapse.
{
  const out = normalizeForSpeech('One   two.\nSecond    para.\n\n  Third.  ');
  assert.equal(out, 'One two.\nSecond para.\nThird.', 'newlines must survive normalization');
}

// The engine-independent spoken-form rules still apply.
{
  assert.match(normalizeForSpeech('It moved $2B.'), /2 billion dollars/);
  assert.match(normalizeForSpeech('A 3× win.'), /3 times/);
  assert.match(normalizeForSpeech('Our CI/CD ran.'), /C I C D/);
  assert.match(normalizeForSpeech('See example.com now.'), /example dot com/);
}

// One chunk per paragraph, with the last one carrying no trailing silence.
{
  const chunks = toChunks('Alpha one.\nBravo two.\nCharlie three.');
  assert.equal(chunks.length, 3, 'one chunk per paragraph');
  assert.deepEqual(
    chunks.map((c) => c.gap),
    [PARAGRAPH_GAP, PARAGRAPH_GAP, 0],
    'paragraph gaps between, none trailing',
  );
}

// A single paragraph is a single request — NOT one request per sentence.
// This is the whole point of the change; if it regresses, flow regresses.
{
  const paragraph = 'First sentence. Second sentence. Third sentence.';
  const chunks = toChunks(paragraph);
  assert.equal(chunks.length, 1, 'a short paragraph must stay one chunk');
  assert.equal(chunks[0].text, paragraph);
  assert.equal(chunks[0].gap, 0);
}

// An over-long paragraph splits at sentence boundaries, under the cap, and the
// interior seams get the shorter sentence gap rather than a paragraph gap.
{
  const sentence = `${'word '.repeat(60).trim()}.`; // ~24s of speech each
  const long = Array.from({ length: 8 }, () => sentence).join(' '); // ~192s
  const chunks = toChunks(long);
  assert.ok(chunks.length > 1, 'an over-long paragraph must split');
  for (const c of chunks) {
    assert.ok(
      estimateSeconds(c.text) <= MAX_CHUNK_SECONDS,
      `chunk of ${estimateSeconds(c.text).toFixed(0)}s exceeds the ${MAX_CHUNK_SECONDS}s cap`,
    );
  }
  assert.deepEqual(
    chunks.slice(0, -1).map((c) => c.gap),
    chunks.slice(0, -1).map(() => SENTENCE_GAP),
    'seams inside one paragraph use the sentence gap',
  );
  // No prose is lost in the split.
  assert.equal(
    chunks.map((c) => c.text).join(' '),
    long,
    'splitting must not drop or duplicate text',
  );
}

// Mixed: a long paragraph followed by a short one — the seam between them is a
// paragraph gap even though the preceding paragraph was split internally.
{
  const sentence = `${'word '.repeat(60).trim()}.`;
  const chunks = toChunks(`${Array.from({ length: 5 }, () => sentence).join(' ')}\nShort tail.`);
  assert.equal(chunks.at(-1).text, 'Short tail.');
  assert.equal(chunks.at(-1).gap, 0, 'final chunk carries no trailing silence');
  assert.equal(chunks.at(-2).gap, PARAGRAPH_GAP, 'seam to the next paragraph is a paragraph gap');
}

// The truncation guard's estimator has to be sane, or it either never fires or
// fires constantly. Assert the PROPERTIES rather than the current rate:
// WORDS_PER_SECOND is retuned whenever DIRECTION changes the delivery, and a
// test pinned to one number just breaks every time that happens.
{
  assert.equal(countWords('one two three'), 3);
  assert.equal(countWords(''), 0);

  const five = estimateSeconds('a b c d e');
  const ten = estimateSeconds('a b c d e f g h i j');
  assert.ok(Math.abs(five * 2 - ten) < 1e-9, 'estimate must scale linearly with word count');

  const impliedWpm = (10 / ten) * 60;
  assert.ok(
    impliedWpm > 100 && impliedWpm < 250,
    `implied ${impliedWpm.toFixed(0)} wpm is outside any plausible narration range`,
  );
}

console.log('chunking self-check: all assertions passed');
