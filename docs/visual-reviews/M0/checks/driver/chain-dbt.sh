#!/usr/bin/env bash
# Runtime A/B of a constant depth bias in texels on top of the source rule (M0-visual-checks). Log: ../dbt-ab.log
# Usage: bash chain-dbt.sh <k> [<k> ...]
export PATH="$(cygpath -u "$APPDATA")/fnm/aliases/default:$PATH" DO_NOT_TRACK=1
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")" || exit 1
L=../dbt-ab2.log
for k in "$@"; do
  echo "== dbt $k" >> $L
  node vt04b.mjs --out ../vt04b/ab --backend webgpu --preset medium --az 250 --tag "ab-dbt$k" --dbt "$k" --targets post,boulder,boot --acne none --tip 1 --views none --suns 60,15,4 >> $L 2>&1
  node vt04b.mjs --out ../vt04b/ab --backend webgpu --preset medium --az 200 --slope toward --tag "ab-slope-dbt$k" --dbt "$k" --targets slopePost,slopeBoot --acne none --views none --suns 15,4 >> $L 2>&1
done
echo "== END" >> $L
