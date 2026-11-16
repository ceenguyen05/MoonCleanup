#!/bin/sh
# Vercel ignoreCommand: exit 0 = skip build, exit 1 = build.
# Skips only when the previous deployed commit is known and nothing relevant to the client changed.
[ -n "$VERCEL_GIT_PREVIOUS_SHA" ] || exit 1
git cat-file -e "$VERCEL_GIT_PREVIOUS_SHA^{commit}" 2>/dev/null || exit 1
git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- \
  apps/client packages assets pnpm-lock.yaml package.json pnpm-workspace.yaml \
  turbo.json vercel.json tsconfig.base.json .nvmrc scripts/vercel-ignore.sh || exit 1
exit 0
