/*
 * Self-check for synthesize()'s two retry budgets.
 *
 * Both only ever run on a bad day, so a regression here stays invisible until
 * a real rebuild either hangs or throws away work already paid for:
 *   - a DAILY-quota 429 reports up to ~20h and must fail fast, not be slept
 *     through — that looks identical to a hung build
 *   - a per-minute throttle 429 reports seconds and must still be waited out
 *   - a dropped connection must be retried rather than discarding the page,
 *     INCLUDING one dropped while the response body is still streaming
 *   - a response that arrives whole but malformed must fail fast
 *
 * Runs against a stubbed fetch: no network, no API key, no spend. The only
 * real waiting is the 1s throttle headroom and the 2s first network backoff.
 *
 * Run: npm run test:audio  (or: node scripts/audio/test-retries.mjs)
 */

import assert from 'node:assert/strict';
import { synthesize } from './make-audio.mjs';

const PCM = Buffer.from('fake-pcm');
const audioBody = {
  candidates: [{ content: { parts: [{ inlineData: { data: PCM.toString('base64') } }] } }],
};

/** Minimal stand-in for a fetch Response: only what synthesize() reads. */
const res = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  text: async () => JSON.stringify(body),
});

/** A response whose headers landed but whose body dies mid-stream. */
const bodyDropped = () => ({
  status: 200,
  ok: true,
  text: async () => {
    throw Object.assign(new TypeError('terminated'), { cause: { code: 'UND_ERR_SOCKET' } });
  },
});

const rateLimited = (retryDelay) => res(429, { error: { details: [{ retryDelay }] } });

/** Stub fetch with a scripted sequence; returns a call counter. */
function stubFetch(...responses) {
  const calls = { n: 0 };
  globalThis.fetch = async () => {
    const next = responses[calls.n++];
    if (next instanceof Error) throw next;
    return next;
  };
  return calls;
}

// A daily quota reset reports ~20h. Waiting that out is never the right move:
// fail immediately so the run's completed pages stay saved and a rerun after
// the reset resumes from there.
{
  const calls = stubFetch(rateLimited('72000s'));
  await assert.rejects(
    () => synthesize('hello', 'key'),
    /quota exhausted/i,
    'a ~20h retry delay must fail fast rather than sleep until tomorrow',
  );
  assert.equal(calls.n, 1, 'a daily-quota 429 must not be retried');
}

// The ceiling must not swallow the case it was carved out of: a short throttle
// delay is still honoured and the request goes through on the next attempt.
{
  const calls = stubFetch(rateLimited('0s'), res(200, audioBody));
  const pcm = await synthesize('hello', 'key');
  assert.equal(calls.n, 2, 'a per-minute throttle must still be waited out');
  assert.deepEqual(pcm, PCM);
}

// fetch() rejects on transport failure; an HTTP error status does not. One
// reset in a multi-request page is close to expected and must not lose it.
{
  const dropped = Object.assign(new TypeError('fetch failed'), {
    cause: { code: 'ECONNRESET' },
  });
  const calls = stubFetch(dropped, res(200, audioBody));
  const pcm = await synthesize('hello', 'key');
  assert.equal(calls.n, 2, 'a dropped connection must be retried');
  assert.deepEqual(pcm, PCM);
}

// fetch() settles once the status and headers arrive, so the audio is still
// streaming when it resolves. A connection dropped THERE rejects on the body
// read, not on the fetch call, and must land in the same budget — otherwise
// the retry looks present and the page is lost anyway.
{
  const calls = stubFetch(bodyDropped(), res(200, audioBody));
  const pcm = await synthesize('hello', 'key');
  assert.equal(calls.n, 2, 'a body that dies mid-stream must be retried');
  assert.deepEqual(pcm, PCM);
}

// The flip side: a body that arrives whole but is not JSON (a proxy error
// page, say) is not a transport failure. Retrying it would just fail again.
{
  const calls = stubFetch({ status: 200, ok: true, text: async () => '<html>502</html>' });
  await assert.rejects(() => synthesize('hello', 'key'), /unparseable JSON/);
  assert.equal(calls.n, 1, 'a malformed payload must not be retried');
}

// A non-429 HTTP error is a real failure and must surface, not spin.
{
  const calls = stubFetch(res(400, { error: { message: 'bad request' } }));
  await assert.rejects(() => synthesize('hello', 'key'), /HTTP 400/);
  assert.equal(calls.n, 1, 'a 4xx that is not a rate limit must not be retried');
}

console.log('retry self-check: all assertions passed');
