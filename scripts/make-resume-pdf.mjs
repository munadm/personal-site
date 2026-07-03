// Builds the site, serves the static output, and print-renders /resume to
// public/resume.pdf via Playwright's Chromium. Run with `npm run resume:pdf`.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 4321;
const PREVIEW_URL = `http://localhost:${PORT}`;

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', cwd: rootDir, ...opts });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

async function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(300);
  }
  throw new Error(`Server at ${url} did not become ready in time`);
}

async function main() {
  console.log('[resume:pdf] Building site...');
  await run('npx', ['astro', 'build']);

  console.log('[resume:pdf] Starting preview server...');
  const preview = spawn('npx', ['astro', 'preview', '--port', String(PORT)], {
    cwd: rootDir,
    stdio: 'pipe',
  });
  preview.stdout.on('data', (d) => process.stdout.write(`[preview] ${d}`));
  preview.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`));

  try {
    await waitForServer(`${PREVIEW_URL}/resume`);

    console.log('[resume:pdf] Rendering PDF with Chromium...');
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(`${PREVIEW_URL}/resume`, { waitUntil: 'networkidle' });
    await page.emulateMedia({ media: 'print' });

    const outPath = path.join(rootDir, 'public', 'resume.pdf');
    await page.pdf({
      path: outPath,
      format: 'Letter',
      printBackground: false,
      margin: { top: '0.4in', bottom: '0.4in', left: '0.5in', right: '0.5in' },
    });

    await browser.close();
    console.log(`[resume:pdf] Wrote ${outPath}`);
  } finally {
    preview.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
