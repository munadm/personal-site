/*
 * Build-time narration generator (WS7 audio narration).
 *
 * For each narratable page it: scrapes the readable prose from the built
 * HTML, synthesizes speech with the Gemini TTS API, encodes a 64 kbps mp3,
 * and writes it to public/audio/. The mp3s are committed like
 * public/resume.pdf, so the DEPLOY build never synthesizes anything —
 * Cloudflare just serves static files, and CI never needs an API key.
 *
 * Chunking is the whole ballgame for flow. The previous Kokoro pipeline
 * synthesized ONE SENTENCE per call and glued the results together with a
 * fixed 70 ms gap, which reset the pitch contour on every sentence and made
 * the structure of the writing inaudible. Prose is now sent a PARAGRAPH at a
 * time, so intonation arcs across the sentences that belong together, and the
 * silence between chunks reflects whether the boundary was a sentence break
 * or a paragraph break.
 *
 * Delivery is steered in words rather than by post-hoc speed adjustment —
 * see DIRECTION. That prompt is the main tuning knob; change it, rerun, listen.
 *
 * Caching: each entry stores a hash of (model + voice + direction + pacing +
 * normalized text). Re-running only re-synthesizes pages whose prose or
 * delivery actually changed, so this is cheap to run on every content edit.
 *
 * Usage (from repo root):
 *   npm run audio               # build site, (re)generate changed narrations
 *   npm run audio -- --skip-build   # reuse existing dist/ (faster iteration)
 *   AUDIO_VOICE=Algieba npm run audio   # override the voice for this run
 *
 * Requires ffmpeg on PATH (PCM -> mp3), Node >= 22, and GEMINI_API_KEY in the
 * environment — the last only when something actually needs synthesizing.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..');
const DIST = join(REPO_ROOT, 'dist');
const OUT_DIR = join(REPO_ROOT, 'public', 'audio');
const MANIFEST = join(OUT_DIR, 'manifest.json');

/*
 * GEMINI_API_KEY lives in a gitignored .env at the repo root. Loading it here
 * rather than via `node --env-file` means every entry point gets it — `npm run
 * audio`, a direct `node scripts/audio/make-audio.mjs`, and the pre-commit
 * hook alike. process.loadEnvFile is built into Node, so this costs no
 * dependency, and a real environment variable still takes precedence over the
 * file for one-off overrides.
 */
try {
  process.loadEnvFile(join(REPO_ROOT, '.env'));
} catch {
  // No .env — fall back to the ambient environment. requireApiKey() reports it.
}

/*
 * 3.1 Flash TTS is the strongest Gemini narration voice on the public TTS
 * arena (Elo 1206, above Eleven v3) and — unlike 2.5 Pro TTS, which Google
 * designates for long-form but sells paid-only — it is free-tier eligible.
 * That keeps this feature's original no-spend rule intact.
 *
 * Note that free tier requires a project with NO billing account attached: a
 * linked billing account at a zero prepay balance blocks every model, free
 * ones included. AUDIO_MODEL=gemini-2.5-pro-preview-tts switches to the paid
 * long-form tier if it ever proves worth $0.37 a regeneration.
 *
 * Sadachbia ("lively") was chosen by ear against all 30 prebuilt voices
 * reading this site's own copy — it beat the documented narration pick,
 * Charon ("informative"). Model and voice are both one-line swaps;
 * regenerate to apply.
 */
const MODEL_ID = process.env.AUDIO_MODEL || 'gemini-3.1-flash-tts-preview';
const VOICE = process.env.AUDIO_VOICE || 'Sadachbia';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:generateContent`;

// Gemini returns 24 kHz 16-bit mono PCM, which ffmpeg takes raw — no WAV
// container needed anywhere in the pipeline.
const SAMPLE_RATE = 24000;
const BYTES_PER_SAMPLE = 2;
const MP3_BITRATE = '64k';

/*
 * How the narrator should read. Style is steered through the prompt itself
 * (the documented "Say cheerfully: …" pattern), not a separate parameter — so
 * this text is prepended to every chunk and is NOT spoken. Keep the trailing
 * colon: a long, discursive direction is the one thing that risks the model
 * reading it aloud.
 *
 * It deliberately says nothing about pace. Two rounds of blind comparison on
 * real paragraphs from this site — six deliveries spanning 101 to 227 wpm —
 * landed here, and every explicit pace instruction lost. Asking for "measured
 * and unhurried" produced 127 wpm that read as laboured; asking for brisk
 * overshot. Setting only who is speaking lets the model pace itself off the
 * punctuation, which is the thing paragraph-level chunking exists to enable.
 *
 * If this is ever retuned, retune it by ear against a real paragraph rather
 * than by reasoning about adjectives. The audition is cheap: a few cents.
 */
export const DIRECTION =
  'You are an engineering leader describing your own work to a respected peer:';

/*
 * Pacing. Real narration separates a sentence break from a paragraph break;
 * a single uniform gap is what made the previous readings sound like a list.
 * MAX_CHUNK_SECONDS keeps each request well inside the window where Gemini
 * documents that "speech quality and consistency may begin to drift" — the
 * case-study format lands most paragraphs comfortably under it anyway.
 */
export const SENTENCE_GAP = 0.35;
export const PARAGRAPH_GAP = 0.8;
export const MAX_CHUNK_SECONDS = 90;
/*
 * Measured from this voice and direction, not assumed: Sadachbia reads real
 * paragraphs from this site at roughly 168 wpm on long clausal prose and
 * 187 wpm on short declarative prose. 2.9 w/s (~174 wpm) sits between them,
 * which keeps the truncation guard's ratio near 1.0 in both cases instead of
 * drifting toward its floor. Retune alongside DIRECTION — a slower direction
 * would strand this value and cause spurious truncation failures.
 */
const WORDS_PER_SECOND = 2.9;

/*
 * Truncation guard. Gemini TTS has documented failure modes where a request
 * returns HTTP 200 with a short or empty audio payload (only the opening of a
 * long transcript, or no inlineData at all). Silently shipping a case study
 * missing its last paragraph is far worse than failing the build, so every
 * chunk is measured against its word count and retried once before giving up.
 *
 * Short chunks are exempt from the ratio test: a heading is a handful of words,
 * where normal delivery variance swamps the estimate and would fail the build
 * on perfectly good audio. They only have to come back non-empty — and gross
 * truncation is a long-transcript failure mode anyway.
 *
 * ponytail: crude words/sec heuristic. It reliably catches gross truncation
 * (the real, documented failure) but will NOT catch a single dropped sentence
 * inside a long chunk — paragraph-sized chunks keep that exposure small.
 * Replace with forced alignment only if this ever proves insufficient.
 */
const TRUNCATION_FLOOR = 0.7;
const MIN_GUARDED_SECONDS = 8;
const MIN_AUDIBLE_SECONDS = 0.2;

/*
 * Rate limits. The free tier allows 10 requests/minute, so a full catalogue
 * rebuild waits out the quota window a couple of times rather than failing —
 * but only for delays that represent throttling.
 *
 * A 429 can mean two very different things. A per-minute throttle reports a
 * delay of seconds and clears on its own. An exhausted DAILY quota reports the
 * time until it resets, which is up to ~20 hours: obeying that literally means
 * sleeping until tomorrow, which looks exactly like a hung build and silently
 * leaves the run half-finished. Anything past this ceiling is treated as
 * "come back later", not "wait here".
 */
const RATE_LIMIT_RETRIES = 6;
const MAX_RATE_LIMIT_WAIT_SECONDS = 300;

// Transient transport failures (ECONNRESET, TLS drops, timeouts) get their own
// budget — see synthesize(). A long case study is dozens of requests, so one
// reset somewhere in the run is close to expected and must not discard the page.
const NETWORK_RETRIES = 4;

/**
 * Discover every narratable case study from the built site rather than a
 * hardcoded list — so a newly added case study is picked up automatically and
 * a "miss" (a real post with no audio) can never slip through. A page counts
 * as a case study when its built HTML carries the case-study template markers,
 * which distinguishes it from any other /work/* route (e.g. the index).
 */
function discoverPages() {
  const workDir = join(DIST, 'work');
  if (!existsSync(workDir)) return [];
  const pages = [];
  for (const entry of readdirSync(workDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const htmlPath = join(workDir, entry.name, 'index.html');
    if (!existsSync(htmlPath)) continue;
    const html = readFileSync(htmlPath, 'utf8');
    if (!html.includes('class="standfirst"') || !html.includes('class="case-body"')) continue;
    pages.push({ slug: entry.name, route: `/work/${entry.name}`, htmlPath });
  }
  return pages.sort((a, b) => a.slug.localeCompare(b.slug));
}

/*
 * Speak symbols and figures the way a person would read them aloud.
 *
 * These are deliberately engine-independent. The espeak-ng respellings this
 * file used to carry ("narration" -> "nehrayshin", "LinkedIn" -> "linktin")
 * existed to fool Kokoro's phonemizer and are gone with it — a model that
 * reads text directly would have spoken them literally wrong.
 *
 * Newlines survive: they are the paragraph boundaries toChunks() splits on.
 */
export function normalizeForSpeech(text) {
  return text
    .replace(/\$(\d+)B\b/g, '$1 billion dollars')
    .replace(/\$(\d+)M\b/g, '$1 million dollars')
    .replace(/\$(\d+)K\b/g, '$1 thousand dollars')
    .replace(/\$(\d+)\b/g, '$1 dollars')
    .replace(/(\d+)\s*×/g, '$1 times')
    .replace(/CI\/CD/g, 'C I C D')
    // A bare domain in prose is read as one mangled word, swallowing the TLD.
    .replace(/\.(com|io|dev|org|net|ai)\b/gi, ' dot $1')
    .replace(/·/g, ', ')
    // Collapse horizontal whitespace only — \n carries the paragraph structure.
    .replace(/[^\S\n]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Pull the spoken script out of a case study's built HTML: the heading, the
 * standfirst, and the body paragraphs — but not the "back to work" link or
 * the at-a-glance facts table, which read poorly aloud. node-html-parser
 * gives us stable selectors over the real rendered output.
 */
function extractNarration(html, parse) {
  const root = parse(html);
  const parts = [];
  const h1 = root.querySelector('.page-intro h1');
  if (h1) parts.push(h1.text.trim());
  const standfirst = root.querySelector('.standfirst');
  if (standfirst) parts.push(standfirst.text.trim());
  for (const p of root.querySelectorAll('.case-body .container > p')) {
    if (p.classList.contains('back-link')) continue;
    const t = p.text.replace(/\s+/g, ' ').trim();
    if (t) parts.push(t);
  }
  // Ensure every part ends with terminal punctuation so the heading reads as
  // its own utterance rather than running into the standfirst.
  const joined = parts
    .map((p) => (/[.!?]$/.test(p) ? p : `${p}.`))
    .join('\n');
  return normalizeForSpeech(joined);
}

export const countWords = (text) => (text.match(/\S+/g) ?? []).length;
export const estimateSeconds = (text) => countWords(text) / WORDS_PER_SECOND;

/** Split one over-long paragraph at sentence boundaries, packing as many
 *  sentences as fit under the per-request cap. */
function splitToCap(paragraph) {
  if (estimateSeconds(paragraph) <= MAX_CHUNK_SECONDS) return [paragraph];
  const pieces = [];
  let buffer = '';
  for (const sentence of paragraph.split(/(?<=[.!?])\s+/)) {
    const candidate = buffer ? `${buffer} ${sentence}` : sentence;
    if (buffer && estimateSeconds(candidate) > MAX_CHUNK_SECONDS) {
      pieces.push(buffer);
      buffer = sentence;
    } else {
      buffer = candidate;
    }
  }
  if (buffer) pieces.push(buffer);
  return pieces;
}

/**
 * One chunk per paragraph, tagged with the silence that should follow it.
 * Paragraph boundaries get a longer pause than sentence boundaries, and the
 * final chunk gets none — trailing silence is just wasted bytes.
 */
export function toChunks(text) {
  const paragraphs = text.split('\n').filter(Boolean);
  const chunks = [];
  paragraphs.forEach((paragraph, pIndex) => {
    const isLastParagraph = pIndex === paragraphs.length - 1;
    const pieces = splitToCap(paragraph);
    pieces.forEach((piece, i) => {
      const endsParagraph = i === pieces.length - 1;
      const gap = isLastParagraph && endsParagraph
        ? 0
        : endsParagraph
          ? PARAGRAPH_GAP
          : SENTENCE_GAP;
      chunks.push({ text: piece, gap });
    });
  });
  return chunks;
}

/** Install the toolchain if absent. Needed just to read/hash the prose, so it
 *  runs before we know whether anything will actually be synthesized. */
function ensureInstalled() {
  if (!existsSync(join(SCRIPT_DIR, 'node_modules', 'node-html-parser'))) {
    console.log('Installing the HTML parser (one-time)…');
    execFileSync('npm', ['install'], { cwd: SCRIPT_DIR, stdio: 'inherit' });
  }
}

/** ffmpeg is only needed when we actually encode an mp3 — checked lazily so a
 *  no-op run on a machine without ffmpeg still succeeds. */
function ensureFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    console.error('ffmpeg not found on PATH — needed to encode mp3. Install it and retry.');
    process.exit(1);
  }
}

/** Same lazy contract as ffmpeg: a run with nothing to regenerate must succeed
 *  without a key, so the pre-commit hook still passes on a fresh clone. */
function requireApiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error(
      'GEMINI_API_KEY is not set — needed to synthesize narration.\n' +
        'Get one at https://aistudio.google.com/apikey, then:\n' +
        '  export GEMINI_API_KEY=…',
    );
    process.exit(1);
  }
  return key;
}

function buildSite() {
  console.log('Building site so narration reflects current prose…');
  execFileSync('npm', ['run', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' });
}

/** Write the manifest with deterministic key order so commits diff cleanly. */
function writeManifest(manifest) {
  const ordered = {};
  for (const k of Object.keys(manifest).sort()) ordered[k] = manifest[k];
  writeFileSync(MANIFEST, `${JSON.stringify(ordered, null, 2)}\n`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Seconds to wait after a 429, or null if this is not a retryable rate limit.
 *
 * The distinction matters: the free tier's requests-per-minute 429 always
 * carries a retry delay and clears on its own, whereas a depleted prepay
 * balance returns the same status with no delay and will never clear by
 * waiting. Retrying that one just burns minutes before failing anyway.
 */
function retryDelaySeconds(bodyText) {
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    parsed = null;
  }
  const structured = parsed?.error?.details
    ?.map((d) => d.retryDelay)
    .find(Boolean);
  const fromField = structured && /^([\d.]+)s$/.exec(structured)?.[1];
  const fromMessage = /retry in ([\d.]+)s/i.exec(bodyText)?.[1];
  const seconds = Number(fromField ?? fromMessage);
  return Number.isFinite(seconds) ? seconds : null;
}

/**
 * One TTS request, riding out rate limits and transient network failures.
 * Returns raw 16-bit PCM.
 *
 * Two independent retry budgets, because the failures are unrelated: a 429 is
 * the server saying "slow down" (wait the delay it reports), while a dropped
 * TLS connection is the network saying nothing at all (wait a moment and try
 * again). Sharing one counter would let a burst of connection resets eat the
 * allowance for legitimate throttling, and vice versa.
 *
 * The transport budget covers the body read as well as the request, because
 * fetch() settling does not mean the response arrived — see below.
 *
 * `voice` and `direction` default to the shipping configuration; auditioning
 * tools override them so a sample is generated through this exact path — same
 * endpoint, same retry behaviour — rather than an approximation that could
 * sound different from what actually ships. Pace is tuned by rewriting
 * `direction`, which is why it is a parameter rather than a hardcoded prefix.
 */
export async function synthesize(text, apiKey, { label = '', voice = VOICE, direction = DIRECTION } = {}) {
  let rateLimitAttempts = 0;
  let networkAttempts = 0;

  for (;;) {
    let status;
    let ok;
    let body;
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${direction}\n\n${text}` }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          },
        }),
      });
      ({ status, ok } = res);
      // The body read belongs INSIDE this try. fetch() settles as soon as the
      // status and headers arrive, so a connection dropped while the (multi-MB,
      // base64) audio is still streaming rejects here rather than above —
      // outside the try that would be a lost page despite the retry budget.
      //
      // Read it as text, not json(): that keeps the retry boundary around
      // transport only. A body that arrives intact but malformed is parsed
      // below and fails fast, because retrying it would just fail again.
      body = await res.text();
    } catch (err) {
      // Transport failure — DNS, TLS, ECONNRESET, timeout — either before the
      // headers or midway through the body. An HTTP error status is NOT an
      // exception and is handled below. Over a 24-request page one reset is
      // close to expected, and without this a single blip discards the page.
      networkAttempts += 1;
      const code = err?.cause?.code ?? err?.message ?? 'network error';
      if (networkAttempts > NETWORK_RETRIES) {
        throw new Error(
          `Gemini TTS network failure after ${NETWORK_RETRIES} retries (${code}). ` +
            'Completed pages are already saved, so rerunning resumes where this stopped.',
        );
      }
      const backoff = 2 ** networkAttempts; // 2s, 4s, 8s, 16s
      console.log(`  … ${label} ${code}, retrying in ${backoff}s`);
      await sleep(backoff * 1000);
      continue;
    }

    if (status !== 429) {
      if (!ok) {
        throw new Error(`Gemini TTS HTTP ${status}: ${body.slice(0, 500)}`);
      }
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        // Deliberately not retried: the bytes all arrived, they are just not
        // the JSON this endpoint promises (a proxy error page, a truncation
        // the transport never reported). Say so rather than surfacing a bare
        // SyntaxError with no hint of where it came from.
        throw new Error(`Gemini TTS returned unparseable JSON: ${body.slice(0, 500)}`);
      }
      const encoded = parsed?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!encoded) {
        throw new Error(`Gemini TTS returned no audio: ${body.slice(0, 500)}`);
      }
      return Buffer.from(encoded, 'base64');
    }

    rateLimitAttempts += 1;
    const wait = retryDelaySeconds(body);
    if (wait !== null && wait > MAX_RATE_LIMIT_WAIT_SECONDS) {
      const hours = (wait / 3600).toFixed(1);
      throw new Error(
        `Gemini TTS quota exhausted: the API wants ${hours}h before the next request, ` +
          'which is a daily quota reset rather than a throttle — not waiting.\n' +
          'Completed pages are already saved, so rerunning after the reset picks up ' +
          'exactly where this stopped.\n' +
          `API said: ${body.slice(0, 400)}`,
      );
    }
    if (wait === null || rateLimitAttempts > RATE_LIMIT_RETRIES) {
      throw new Error(`Gemini TTS HTTP 429: ${body.slice(0, 500)}`);
    }
    // +1s of headroom: the quota window is measured server-side and coming
    // back a hair early just earns another 429. Log the API's own reason —
    // "throttled" and "out of quota" look identical without it.
    const reason = /Quota exceeded for metric: (\S+)/.exec(body)?.[1] ?? 'rate limit';
    console.log(`  … ${label} ${reason}, waiting ${Math.ceil(wait + 1)}s`);
    await sleep((wait + 1) * 1000);
  }
}

/** Synthesize with the truncation guard: measure what came back against what
 *  the word count predicts, and retry once before failing the build. */
async function synthesizeChecked(chunk, apiKey, label) {
  const expected = estimateSeconds(chunk.text);
  const floor = expected < MIN_GUARDED_SECONDS
    ? MIN_AUDIBLE_SECONDS
    : expected * TRUNCATION_FLOOR;
  let lastSeconds = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const pcm = await synthesize(chunk.text, apiKey, { label });
    lastSeconds = pcm.length / BYTES_PER_SAMPLE / SAMPLE_RATE;
    if (lastSeconds >= floor) return pcm;
    console.warn(
      `  ! ${label}: got ${lastSeconds.toFixed(1)}s for ~${expected.toFixed(1)}s of text` +
        ` — ${attempt === 1 ? 'looks truncated, retrying' : 'still short'}`,
    );
  }
  throw new Error(
    `${label}: audio came back ${lastSeconds.toFixed(1)}s against an expected ` +
      `~${expected.toFixed(1)}s (floor ${floor.toFixed(1)}s) after a retry. ` +
      'Refusing to ship a truncated narration.',
  );
}

async function main() {
  if (!process.argv.includes('--skip-build')) buildSite();
  if (!existsSync(DIST)) {
    console.error('No dist/ — run `npm run build` first or drop --skip-build.');
    process.exit(1);
  }

  ensureInstalled();
  const { parse } = await import('node-html-parser');

  mkdirSync(OUT_DIR, { recursive: true });
  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};

  const pages = discoverPages();
  if (pages.length === 0) {
    console.error('No case study pages found in dist/work — did the build run?');
    process.exit(1);
  }

  // Decide what needs (re)generating, so we only spend on a real miss or
  // change. A page with no manifest entry is a miss; a hash mismatch means the
  // prose, the voice, the model or the delivery direction changed.
  const jobs = [];
  for (const page of pages) {
    const text = extractNarration(readFileSync(page.htmlPath, 'utf8'), parse);
    const hash = createHash('sha256')
      .update(`${MODEL_ID}|${VOICE}|${SENTENCE_GAP}|${PARAGRAPH_GAP}\n${DIRECTION}\n${text}`)
      .digest('hex')
      .slice(0, 16);
    const mp3Path = join(OUT_DIR, `${page.slug}.mp3`);
    const prev = manifest[page.slug];
    if (prev && prev.hash === hash && existsSync(mp3Path)) {
      console.log(`✓ ${page.slug} — up to date`);
      continue;
    }
    console.log(`● ${page.slug} — ${prev ? 'prose or delivery changed' : 'new case study, no audio yet'}`);
    jobs.push({ ...page, text, hash, mp3Path });
  }

  if (jobs.length === 0) {
    console.log('All narrations up to date.');
    return;
  }

  ensureFfmpeg();
  const apiKey = requireApiKey();
  console.log(`Synthesizing with ${MODEL_ID} (${VOICE})…`);

  for (const job of jobs) {
    const chunks = toChunks(job.text);
    console.log(`♪ ${job.slug} — ${chunks.length} chunks, ${countWords(job.text)} words…`);
    const parts = [];
    for (const [i, chunk] of chunks.entries()) {
      const pcm = await synthesizeChecked(chunk, apiKey, `${job.slug} chunk ${i + 1}/${chunks.length}`);
      parts.push(pcm);
      if (chunk.gap > 0) {
        parts.push(Buffer.alloc(Math.round(SAMPLE_RATE * chunk.gap) * BYTES_PER_SAMPLE));
      }
    }
    const pcm = Buffer.concat(parts);

    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1', '-i', 'pipe:0',
        '-codec:a', 'libmp3lame', '-b:a', MP3_BITRATE,
        '-metadata', `title=${job.slug} (AI-narrated)`,
        '-metadata', `artist=Gemini TTS (${MODEL_ID})`,
        job.mp3Path,
      ],
      { input: pcm, stdio: ['pipe', 'ignore', 'ignore'], maxBuffer: 1024 * 1024 * 256 },
    );

    const seconds = pcm.length / BYTES_PER_SAMPLE / SAMPLE_RATE;
    const bytes = readFileSync(job.mp3Path).length;
    manifest[job.slug] = {
      route: job.route,
      hash: job.hash,
      minutes: Math.max(1, Math.round(seconds / 60)),
    };
    // Checkpoint after every page, not once at the end: a rate limit or a
    // network blip partway through a rebuild would otherwise discard the
    // pages already paid for and synthesized, and the rerun would redo them.
    writeManifest(manifest);
    console.log(
      `  → ${(seconds / 60).toFixed(1)} min, ${(bytes / 1024 / 1024).toFixed(2)} MB`,
    );
  }

  console.log(`\nWrote ${jobs.length} narration(s) + manifest.json.`);
}

// Only run when invoked directly, so test-chunking.mjs can import the pure
// helpers above without kicking off a build.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
