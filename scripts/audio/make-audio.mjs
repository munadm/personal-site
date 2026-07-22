/*
 * Build-time narration generator (WS7 audio narration).
 *
 * For each narratable page it: scrapes the readable prose from the built
 * HTML, synthesizes speech locally with Kokoro (open-weights, MIT, $0, no
 * subscription), encodes a 64 kbps mp3, and writes it to public/audio/. The
 * mp3s are committed like public/resume.pdf, so the DEPLOY build never loads
 * a 300MB model — Cloudflare just serves static files.
 *
 * Caching: each entry stores a hash of (voice + normalized text). Re-running
 * only re-synthesizes pages whose prose actually changed, so this is cheap to
 * run on every content edit.
 *
 * This lives in scripts/audio/ with its own package.json precisely so the
 * onnxruntime dependency tree stays out of the root install and never slows
 * the pre-commit hook or CI `npm ci`.
 *
 * Usage (from repo root):
 *   npm run audio               # build site, (re)generate changed narrations
 *   npm run audio -- --skip-build   # reuse existing dist/ (faster iteration)
 *   AUDIO_VOICE=am_onyx npm run audio   # override the voice for this run
 *
 * Requires ffmpeg on PATH (WAV -> mp3). Node >= 22.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..');
const DIST = join(REPO_ROOT, 'dist');
const OUT_DIR = join(REPO_ROOT, 'public', 'audio');
const MANIFEST = join(OUT_DIR, 'manifest.json');

// The narration voice. A one-line swap — regenerate to apply site-wide.
// Candidates were compared by ear before this was chosen; see the PR.
const VOICE = process.env.AUDIO_VOICE || 'am_onyx';
const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const SAMPLE_RATE = 24000;
const MP3_BITRATE = '64k';
// Pacing. Kokoro's `speed` stretches the speech itself; GAP_SECONDS is the
// silence inserted between sentences. The default (1.0 / 0.28) read as slow
// and halting, so speech is nudged faster and the dead air between sentences
// cut back. Listeners can still speed up further in the native player.
const SPEED = 1.15;
const GAP_SECONDS = 0.1;

/*
 * Pronunciation fixes. Kokoro phonemizes via espeak-ng, which mis-stresses a
 * few words. There is no per-word phoneme-injection syntax in this build, so
 * the reliable lever is to respell the word into one espeak reads correctly —
 * each respelling below was verified against the phonemizer to land on the
 * intended IPA, and the target was chosen by ear from synthesized candidates:
 *   rewrite  ɹᵻɹˈaɪt "rer-ite"  -> re-write  ɹˌiːɹˈaɪt "ree-rite"
 *   domain   dəmˈeɪn (heavy schwa) -> demain  dᵻmˈeɪn (lighter first vowel)
 *   endpoint ɛndpˈɔɪnt (d swallowed) -> end point ˈɛnd pˈɔɪnt (crisp d)
 *   enjoy    ɛndʒˈɔɪ (hard "en")  -> injoy   ɪndʒˈɔɪ (reduced first vowel)
 *   LinkedIn lˈɪŋkt ˈɪn (two beats) -> linktin lˈɪŋktɪn "LINK-tin"
 * Keys are matched whole-word, case-insensitively.
 */
const LEXICON = {
  rewrite: 're-write',
  rewrites: 're-writes',
  rewriting: 're-writing',
  domain: 'demain',
  domains: 'demains',
  endpoint: 'end point',
  endpoints: 'end points',
  enjoy: 'injoy',
  LinkedIn: 'linktin',
};

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

/** Speak symbols and figures the way a person would read them aloud. */
function normalizeForSpeech(text) {
  for (const [word, respelling] of Object.entries(LEXICON)) {
    text = text.replace(new RegExp(`\\b${word}\\b`, 'gi'), respelling);
  }
  return text
    .replace(/\$(\d+)B\b/g, '$1 billion dollars')
    .replace(/\$(\d+)M\b/g, '$1 million dollars')
    .replace(/\$(\d+)K\b/g, '$1 thousand dollars')
    .replace(/\$(\d+)\b/g, '$1 dollars')
    .replace(/(\d+)\s*×/g, '$1 times')
    .replace(/×/g, ' times ')
    .replace(/CI\/CD/g, 'C I C D')
    .replace(/·/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
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
  // Ensure every part ends with terminal punctuation so the sentence
  // splitter treats the heading as its own utterance.
  const joined = parts
    .map((p) => (/[.!?]$/.test(p) ? p : `${p}.`))
    .join('\n');
  return normalizeForSpeech(joined);
}

/** Split into sentence-sized utterances: one generate() call truncates at
 *  the model's ~510-token context, so long prose MUST be chunked. */
function toSentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Install the toolchain if absent. Needed just to read/hash the prose, so it
 *  runs before we know whether anything will actually be synthesized. */
function ensureInstalled() {
  if (!existsSync(join(SCRIPT_DIR, 'node_modules', 'node-html-parser'))) {
    console.log('Installing the TTS toolchain (one-time, ~500MB)…');
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

  // Drop audio for case studies that no longer exist, so the manifest always
  // maps exactly to the real posts.
  let manifestChanged = false;
  const liveSlugs = new Set(pages.map((p) => p.slug));
  for (const key of Object.keys(manifest)) {
    if (!liveSlugs.has(key)) {
      console.log(`⤫ ${key} — case study removed, dropping its audio`);
      rmSync(join(OUT_DIR, `${key}.mp3`), { force: true });
      delete manifest[key];
      manifestChanged = true;
    }
  }

  // Decide what needs (re)generating, so the model only loads on a real miss
  // or change. A page with no manifest entry is a miss; a hash mismatch means
  // the prose (or voice/pacing) changed.
  const jobs = [];
  for (const page of pages) {
    const text = extractNarration(readFileSync(page.htmlPath, 'utf8'), parse);
    const hash = createHash('sha256')
      .update(`${VOICE}|${SPEED}|${GAP_SECONDS}\n${text}`)
      .digest('hex')
      .slice(0, 16);
    const mp3Path = join(OUT_DIR, `${page.slug}.mp3`);
    const prev = manifest[page.slug];
    if (prev && prev.hash === hash && existsSync(mp3Path)) {
      console.log(`✓ ${page.slug} — up to date`);
      continue;
    }
    const reason = !prev
      ? 'new case study, no audio yet'
      : !existsSync(mp3Path)
        ? 'mp3 missing'
        : 'prose or voice changed';
    console.log(`● ${page.slug} — ${reason}`);
    jobs.push({ ...page, text, hash, mp3Path });
  }

  if (jobs.length === 0) {
    if (manifestChanged) writeManifest(manifest);
    console.log('All narrations up to date.');
    return;
  }

  ensureFfmpeg();
  console.log(`Loading Kokoro (${VOICE})…`);
  const { KokoroTTS } = await import('kokoro-js');
  const tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: 'q8', device: 'cpu' });

  const gap = new Float32Array(Math.round(SAMPLE_RATE * GAP_SECONDS)); // pause between sentences

  for (const job of jobs) {
    const sentences = toSentences(job.text);
    console.log(`♪ ${job.slug} — ${sentences.length} utterances…`);
    const buffers = [];
    let RawAudioCtor;
    for (const sentence of sentences) {
      const audio = await tts.generate(sentence, { voice: VOICE, speed: SPEED });
      RawAudioCtor ||= audio.constructor;
      buffers.push(audio.audio, gap);
    }
    const total = buffers.reduce((n, b) => n + b.length, 0);
    const combined = new Float32Array(total);
    let offset = 0;
    for (const b of buffers) {
      combined.set(b, offset);
      offset += b.length;
    }

    // toWav() is synchronous and returns the encoded bytes; save() is async
    // and would never flush before the blocking ffmpeg call runs.
    const wavPath = join(SCRIPT_DIR, `${job.slug}.wav`);
    const wav = new RawAudioCtor(combined, SAMPLE_RATE).toWav();
    writeFileSync(wavPath, Buffer.from(wav));
    execFileSync('ffmpeg', [
      '-y', '-i', wavPath,
      '-codec:a', 'libmp3lame', '-b:a', MP3_BITRATE,
      '-metadata', `title=${job.slug} (AI-narrated)`,
      '-metadata', 'artist=Kokoro TTS',
      job.mp3Path,
    ], { stdio: 'ignore' });
    rmSync(wavPath, { force: true });

    const seconds = combined.length / SAMPLE_RATE;
    const bytes = readFileSync(job.mp3Path).length;
    manifest[job.slug] = {
      route: job.route,
      voice: VOICE,
      hash: job.hash,
      seconds: Math.round(seconds),
      minutes: Math.max(1, Math.round(seconds / 60)),
      bytes,
      chars: job.text.length,
    };
    console.log(
      `  → ${(seconds / 60).toFixed(1)} min, ${(bytes / 1024 / 1024).toFixed(2)} MB`,
    );
  }

  writeManifest(manifest);
  console.log(`\nWrote ${jobs.length} narration(s) + manifest.json.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
