## First principles (enforced)

Accessibility wins every conflict. The principles are codified as the suite `npm test` runs — the audio generator's self-checks, then Playwright — and a pre-commit hook runs the build plus that same suite before every commit. CI runs the identical command, so keep new checks inside `npm test` rather than beside it. One-time setup per clone:

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
- **Screenshots for anything visible.** Capture the same page or component before and after so a reviewer validates by eye instead of by trusting the description. Build the previous state from `main` in a scratch worktree, serve it on another port, and shoot both with the same viewport and colour scheme. **Never commit screenshots**, not to the branch and not to an assets branch: review images are not source, and git history is forever. Attach them by dragging the files into the PR body on github.com, which uploads them to GitHub's own CDN. Since that upload needs the web UI, an agent preparing a PR leaves the captured files on disk, says where they are, and writes the before/after in words so the description stands on its own if nobody attaches anything.
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
