# personal-site

The source for [munadmahinoor.com](https://munadmahinoor.com), the personal site of Munad
Mahinoor, an engineering leader. It is a static [Astro](https://astro.build/) build with
self-hosted fonts, no analytics, and no runtime dependency on any third party.

Accessibility wins every conflict. That is the first principle of the project, and the
Playwright suite enforces it rather than the README asserting it.

## Pages

| Route | What it is |
| --- | --- |
| `/` | Homepage |
| `/work` | Selected work, the index of the case studies |
| `/work/bnpl-platform` | Case study: leading BNPL platform engineering at PayPal |
| `/work/simplification-layer` | Case study: shipping a rewrite's outcome without the rewrite |
| `/work/llm-pii-scanner` | Case study: an LLM-driven PII scanner as a standing compliance control |
| `/writing` | Essays, listed from the blog |
| `/resume` | Resume, also rendered to `public/resume.pdf` |
| `/contact` | Contact |
| `/accessibility` | Accessibility statement |
| `/colophon` | Colophon |
| `/404` | Not found |

## Accessibility

- Semantic landmarks, one `h1` per page, no skipped heading levels, and a skip link on
  every route.
- A visible `:focus-visible` outline on everything focusable.
- Body text targets AAA (7:1) contrast. Text is never placed over a pattern.
- Nothing animates in either motion mode. Decorative SVG is `aria-hidden`.
- Every route reflows to 320px with no horizontal scroll and stays readable under forced
  colors.
- Both themes are scanned, so dark mode is held to the same bar as light.

Each commitment above is a test. The suite is the specification.

| Spec | Checks |
| --- | --- |
| `tests/a11y/axe.spec.ts` | axe-core on every route in light and dark, with the WCAG 2.2 AA and AAA tags engaged |
| `tests/a11y/keyboard.spec.ts` | skip link, DOM-order tab through the header, visible focus, Enter activation, no keyboard trap |
| `tests/a11y/forced-colors.spec.ts` | text and links stay visible under forced colors |
| `tests/a11y/motion.spec.ts` | no running animation in either motion mode |
| `tests/a11y/reflow.spec.ts` | no horizontal scroll or overflow at 320px |
| `tests/a11y/structure.spec.ts` | one h1, no skipped heading levels, one banner/main/contentinfo |
| `tests/a11y/theme-toggle.spec.ts` | the toggle flips `[data-theme]`, persists it, and reapplies it before paint |
| `tests/a11y/aria-snapshot.spec.ts` | locks each route's `<main>` accessibility tree |
| `tests/a11y/virtual-screen-reader.spec.ts` | virtual screen-reader narration of the built HTML, in order |
| `tests/a11y/audio.spec.ts` | every narrated page exposes one native `<audio>` player, labelled honestly, with an mp3 that resolves |
| `tests/fold.spec.ts` | the hero fits the fold on phone viewports with no horizontal scroll |
| `tests/voiceover/` | real macOS VoiceOver narration of the homepage, run as a launch gate |

Regenerate ARIA snapshots deliberately with
`npx playwright test aria-snapshot --update-snapshots`.

## Run and test

```sh
npm install
npm run dev      # local dev server
npm run build    # static build to ./dist
npm run preview  # serve the build locally
npm test         # build, preview on :4173, run the full Playwright suite
```

One time per clone, enable the pre-commit hook:

```sh
git config core.hooksPath .githooks
```

The hook builds the site and runs the full suite before every commit. Do not bypass it
with `--no-verify` except in an emergency. CI runs the same suite on every push and every
pull request.

`npm run resume:pdf` print-renders `/resume` to `public/resume.pdf`, so the PDF and the
page cannot disagree.

### Real VoiceOver gate

`tests/voiceover/` drives actual macOS VoiceOver through
[@guidepup/playwright](https://github.com/guidepup/guidepup). It is macOS-only, slow, and
needs `npx guidepup setup` once, so it is excluded from the default run:

```sh
VOICEOVER=1 npx playwright test --project=voiceover
```

[`voiceover-gate.yml`](.github/workflows/voiceover-gate.yml) runs it on demand and on `v*`
release tags. It also runs on pushes to `main` that touch the files the homepage narrates,
so a change that could alter the narration gets the real check without anyone remembering
to ask for it.

## Audio narration

Each case study carries an AI-narrated reading, synthesized locally with
[Kokoro](https://github.com/hexgrad/kokoro). No API is involved and the model never runs
in CI.

```sh
npm run audio    # regenerate changed narrations into public/audio/
```

The mp3s are committed like `public/resume.pdf`, so the deploy build only serves static
files. The generator finds case studies in the build output instead of a hardcoded list,
hashes their prose into `public/audio/manifest.json`, and re-synthesizes only what
changed. Its large TTS toolchain lives in `scripts/audio/` with its own `package.json`,
kept out of the root dependency graph so `npm ci` stays fast. It needs `ffmpeg` on `PATH`.

You rarely run it by hand. When a commit touches `src/pages/work/*.astro`, the pre-commit
hook rebuilds the affected narration and stages it into the same commit, which stops the
audio drifting from the text. Voice and pacing are constants at the top of
`scripts/audio/make-audio.mjs`, and mispronunciations are fixed with a respelling table in
the same file.

The player is a native `<audio controls>` element, keyboard- and screen-reader-operable
without any script of ours.

## The Writing page

`/writing` does not retype the essay list. The blog repo publishes its essays at
[`blog.munadmahinoor.com/essays.json`](https://blog.munadmahinoor.com/essays.json), and
its deploy job commits the same file here as `src/data/essays.json`, which rebuilds this
site. Publishing an essay on the blog is the only step needed to list it here. Reading a
committed file rather than fetching at build time keeps this build self-contained, so an
outage on the blog cannot fail a deploy here.

## Stack and design

- Astro, static output, TypeScript strict, no UI framework.
- [Archivo](https://fonts.google.com/specimen/Archivo) variable font, self-hosted through
  `@fontsource-variable/archivo`. No font CDN at runtime.
- [@astrojs/sitemap](https://docs.astro.build/en/guides/integrations-guide/sitemap/) for
  `sitemap-index.xml`.
- Plain CSS design tokens in `src/styles/tokens.css` over base styles in
  `src/styles/global.css`. The whole stylesheet is inlined at build time, since it is
  small enough that a separate request costs more than it saves.
- Near-black on white with a dark inverse, plus one warm accent. The accent shade used
  behind text is contrast-checked, and the brighter one is reserved for large non-text
  graphics.
- Type scale: 12 / 14 / 16 / 18 / 24 / 32 / 48 / 72 px.
- The only script that runs unconditionally is a few inline lines in the head that restore
  the stored theme before first paint. The theme toggle is the one other piece of client
  JavaScript.

## Deploy and rollback

- Deploy is automatic. A push to `main` runs [`ci.yml`](.github/workflows/ci.yml), which
  builds, runs the full suite, then publishes `dist/` to Cloudflare Pages with
  `wrangler pages deploy dist --project-name=personal-site --branch=main`. Pull requests
  build and test but never deploy.
- The deploy job tags each deployed commit `deploy-<UTC timestamp>`, so
  `git tag -l 'deploy-*'` is the deploy history.
- Rollback is a workflow. `gh workflow run rollback.yml` redeploys the previous `deploy-*`
  tag, and `-f target=<tag-or-sha>` picks a specific one. Follow it with a revert PR on
  `main` so the next merge does not republish the bad build.
- Required repo secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- `public/_headers` ships with the build, and Cloudflare applies it as security response
  headers.

First-time setup and debugging notes are in [`deploy_guide.md`](deploy_guide.md).

## License

Content and design © Munad Mahinoor. Code is provided for reference.
