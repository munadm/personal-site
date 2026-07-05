# Deploy guide

How this site gets to production, how to set it up from scratch, and how to
debug it when it breaks.

## Architecture

- **Host:** Cloudflare Pages, project **`personal-site`** (direct-upload
  project, production branch `main`). Production URL:
  <https://personal-site-avx.pages.dev>
- **What gets deployed:** the static `dist/` folder produced by `npm run build`
  (Astro). `public/_headers` is included in the build output and Cloudflare
  Pages applies it as response headers (security headers).
- **Trigger:** the `deploy` job in [.github/workflows/ci.yml](.github/workflows/ci.yml).
  It runs **only on a push to `main`** (i.e. merging a PR), never on PRs, and
  only after the `build-and-test` job (build + Playwright fold/a11y suite)
  passes.
- **Mechanism:** `cloudflare/wrangler-action@v3` runs
  `wrangler pages deploy dist --project-name=personal-site --branch=main`,
  authenticated with an API token stored as a GitHub secret. `--branch=main`
  is what makes the deployment *production* rather than a preview.

There is no git integration on the Cloudflare side — Cloudflare never reads
the repo. GitHub Actions builds and uploads the files.

## One-time setup

These are already done for this repo, but if you recreate the project or fork
this setup:

### 1. Create the Pages project

```sh
npx wrangler login   # opens browser OAuth
npx wrangler pages project create personal-site --production-branch=main
```

### 2. Create a Cloudflare API token (manual, dashboard only)

The GitHub Action cannot use your OAuth login; it needs a scoped API token.

1. Go to <https://dash.cloudflare.com/profile/api-tokens> → **Create Token**
   → **Create Custom Token**.
2. Permissions: **Account → Cloudflare Pages → Edit** (that single permission
   is sufficient).
3. Account Resources: limit to your account.
4. Create it and copy the token value — it is shown only once.

### 3. Set the GitHub repo secrets

```sh
gh secret set CLOUDFLARE_API_TOKEN --repo munadm/personal-site   # paste token when prompted
gh secret set CLOUDFLARE_ACCOUNT_ID --repo munadm/personal-site --body "b9d82027d48d5a000c185a666ebc43c2"
```

The account ID is not sensitive (it appears in `wrangler whoami`), but keeping
it as a secret keeps the workflow file portable.

## The deploy pipeline, step by step

When a PR merges to `main`, the CI workflow runs two jobs in sequence. Each
step below is a distinct failure point — debug in this order.

| # | Step | What can go wrong |
|---|------|-------------------|
| 1 | `build-and-test` job | Build error or a Playwright (fold/a11y) failure blocks the deploy entirely. Fix the test, not the pipeline — accessibility wins every conflict. |
| 2 | `deploy` job gate (`if:`) | Deploy only fires for `push` events on `refs/heads/main`. If the job is skipped, check the event type/branch. |
| 3 | `npm ci` + `npm run build` | The deploy job rebuilds from scratch. Same failure modes as local `npm run build`. |
| 4 | wrangler-action auth | `Authentication error [code: 10000]` → `CLOUDFLARE_API_TOKEN` secret is missing, expired, revoked, or lacks the Pages:Edit permission. |
| 5 | wrangler-action project lookup | `Project not found [code: 8000007]` → project name mismatch or wrong `CLOUDFLARE_ACCOUNT_ID`. Verify with `npx wrangler pages project list`. |
| 6 | Upload + deploy | Transient Cloudflare errors — re-run the failed job from the Actions UI. |

## Debugging checklist

- **Where are the logs?** GitHub → Actions tab → the CI run for the merge
  commit → `deploy` job.
- **Did the deploy actually happen?** `npx wrangler pages deployment list
  --project-name=personal-site`, or Cloudflare dashboard → Workers & Pages →
  personal-site → Deployments.
- **Site serving stale content?** Check that the newest deployment is marked
  *Production*. A deployment made without `--branch=main` lands as a *Preview*
  (own hash URL) and does not update the production URL.
- **Headers missing in production?**
  `curl -sI https://personal-site-avx.pages.dev/` should show
  `x-content-type-options`, `x-frame-options`, `referrer-policy`, and
  `permissions-policy`. If not, confirm `_headers` is present in `dist/` after
  a local build (it is copied from `public/`).
- **Token sanity check (locally):**
  `CLOUDFLARE_API_TOKEN=<token> npx wrangler whoami` should report the token
  and account without prompting for login.

## Manual deploy (fallback / emergency)

If Actions is down or you need to ship without a merge:

```sh
npm run build
npx wrangler pages deploy dist --project-name=personal-site --branch=main
```

This uses your local `wrangler login` OAuth session. Omit `--branch=main` to
push a preview deployment instead (gets its own `<hash>.personal-site-avx.pages.dev`
URL, production untouched).

## Rollback

Cloudflare dashboard → Workers & Pages → personal-site → Deployments → pick a
previous production deployment → **Rollback**. This is instant and does not
touch git; follow up with a revert commit on `main` so the next merge doesn't
re-deploy the bad version.
