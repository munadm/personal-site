# personal-site

The source for **munadmahinoor.com** — a fast, zero-JavaScript personal site for an
engineering leader. Built with [Astro](https://astro.build/), self-hosted fonts, and a
small op-art-inspired design system where **accessibility wins every conflict**.

## Status

Early build. The current pages are two throwaway homepage **prototypes** sharing a
single set of design tokens, plus a chooser page to compare them:

| Route            | What it is                                                      |
| ---------------- | -------------------------------------------------------------- |
| `/`              | Prototype chooser                                              |
| `/proto/signal`  | **Signal** — bold geometric hero, concentric-circle motif      |
| `/proto/ledger`  | **Ledger** — editorial ruled grid, table-of-contents index     |

## Stack

- **Astro** (static output, TypeScript strict, no UI framework — target zero client JS)
- **[@astrojs/sitemap](https://docs.astro.build/en/guides/integrations-guide/sitemap/)** for `sitemap-index.xml`
- **[Archivo](https://fonts.google.com/specimen/Archivo) variable font**, self-hosted via
  `@fontsource-variable/archivo` — no external font CDN at runtime
- Plain CSS design tokens (`src/styles/tokens.css`) + base styles (`src/styles/global.css`)

No analytics, no external CDN requests at runtime, no client-side JavaScript, minimal
dependencies.

## Design system

Op-art influence is expressed **only** through static means: geometric variable
typography, an 8px spacing scale, static SVG geometric motifs (concentric circles,
line-weight marks, checkerboard), and striped/ruled section dividers. Hover states are
the only interactivity.

- **Palette**: near-black `#111` on white with a dark-mode inverse via
  `prefers-color-scheme`, plus one warm accent. Text-safe accent shades are
  contrast-checked; the brighter accent is reserved for large non-text graphics.
- **Type scale**: 12 / 14 / 16 / 18 / 24 / 32 / 48 / 72 px.
- **No** moiré, **no** vibrating complementary-color adjacency, **no** autoplaying motion.
  Any transition is wrapped in `@media (prefers-reduced-motion: no-preference)`; the
  default state is fully static.

## Accessibility commitments

- Semantic landmarks (`header` / `nav` / `main` / `footer`), a real heading hierarchy,
  and a skip link on every page.
- Visible `:focus-visible` states: a 3px high-contrast outline with offset.
- Body text targets **AAA (7:1)** contrast on plain backgrounds — text is never placed
  over patterns.
- Decorative SVG motifs are `aria-hidden`; the design is keyboard-navigable throughout.
- Verified with an automated **axe-core** pass (WCAG 2.0 / 2.1 / 2.2, levels A + AA):
  **zero violations** across all routes.
- Respects `prefers-reduced-motion` and `prefers-color-scheme`.

## Develop

```sh
npm install
npm run dev      # local dev server
npm run build    # static build to ./dist
npm run preview  # serve the build locally
```

### Audio narration

The case studies carry an AI-narrated reading, synthesized at build time with
[Kokoro](https://github.com/hexgrad/kokoro) (open-weights, MIT, runs locally, no API).

```sh
npm run audio    # (re)generate changed narrations into public/audio/
```

The generated mp3s are committed like `public/resume.pdf`, so the deploy build never loads
a model — Cloudflare just serves static files. The generator **discovers case studies from
the build itself** (no hardcoded list), so a new post can't be missed; it hash-caches in
`public/audio/manifest.json` and only re-synthesizes pages whose prose (or the voice/pacing)
actually changed. The ~500MB TTS toolchain is isolated in `scripts/audio/` with its own
`package.json`, deliberately kept out of the root dependency graph so it never slows CI
`npm ci`. Requires `ffmpeg` on `PATH`.

You rarely run it by hand: the **pre-commit hook builds narration just in time**. When a
commit touches a case study (`src/pages/work/*.astro`), the hook reconciles the audio —
building any missing or changed narration and staging it into the same commit — so audio
never drifts from the text. Commits that don't touch a case study skip it entirely. Voice
and pacing live as constants at the top of `scripts/audio/make-audio.mjs` (`VOICE`, `SPEED`,
`GAP_SECONDS`); mispronunciations are fixed with a small verified respelling `LEXICON`.

## License

Content and design © Munad Mahinoor. Code is provided for reference.
