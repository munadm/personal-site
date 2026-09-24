#!/bin/sh
# Bring the social cards up to date for the commit being made. Called by
# .githooks/pre-commit after the build.
#
# Two copies of the cards matter here, and they can differ:
#   - the working tree's, which the suite that runs next checks against the
#     working tree's pages;
#   - the index's, which is what gets committed and what CI checks against the
#     committed pages.
#
# When nothing under src/ or scripts/og/ has unstaged or untracked changes,
# those are the same pages, so the working-tree render is the committed one and
# is staged as is.
#
# When there are such edits, the working-tree render may reflect words that
# are not being committed. Staging it would pass locally and fail CI. So the
# committed cards are rendered separately, from a snapshot of exactly what is
# staged, and written into the index alone. The working tree keeps the cards
# for its own pages, which get committed later along with those edits.
set -e

node scripts/og/make-cards.mjs --skip-build

if [ -z "$(git diff --name-only -- src scripts/og)$(git ls-files --others --exclude-standard -- src scripts/og)" ]; then
  git add public/og
  exit 0
fi

echo "pre-commit: unstaged edits under src/ or scripts/og/: rendering the committed cards from the staged snapshot..."
snapshot=$(mktemp -d)
trap 'rm -rf "$snapshot"' EXIT
git checkout-index --all --prefix="$snapshot/"
ln -s "$(pwd)/node_modules" "$snapshot/node_modules"
(cd "$snapshot" && npx astro build > /dev/null && node scripts/og/make-cards.mjs --skip-build)

for card in "$snapshot"/public/og/*; do
  path="public/og/$(basename "$card")"
  git update-index --add --cacheinfo "100644,$(git hash-object -w "$card"),$path"
done
# A card whose page is gone from the snapshot leaves the index too.
git ls-files -- public/og | while read -r path; do
  [ -e "$snapshot/$path" ] || git update-index --force-remove -- "$path"
done
