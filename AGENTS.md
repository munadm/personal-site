## First principles (enforced)

Accessibility wins every conflict. The principles are codified as the Playwright suite (`npx playwright test`), and a pre-commit hook runs the build plus the full suite before every commit. One-time setup per clone:

```
git config core.hooksPath .githooks
```

Do not bypass with `--no-verify` except for emergencies; CI runs the same suite on every push and PR.

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Pull requests

Every PR shows the change, it does not just describe it.

- **Before and after.** If the change alters how the system behaves, state both sides: the old path and the new one, the old value and the new value. A table or a short two-column contrast beats a paragraph. If a number moved (a runtime, a file size, a test count), give both numbers.
- **Screenshots for anything visible.** Capture the same page or component before and after and put them side by side, so a reviewer validates by eye instead of by trusting the description. Build the previous state from `main` in a scratch worktree, serve it on another port, and shoot both with the same viewport and colour scheme.
- **Say what did not change.** Reviewers spend their attention on the parts you leave silent. Call out what was deliberately left alone and why.
- **Show the check.** Paste the result of the suite that proves it, with counts.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
