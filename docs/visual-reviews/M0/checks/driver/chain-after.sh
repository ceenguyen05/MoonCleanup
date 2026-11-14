#!/usr/bin/env bash
# Re-measure after the shadow-bias fix (M0-visual-checks). One capture at a time; log in ../after.log.
# Usage: bash chain-after.sh <step> [<step> ...]   steps: flat slope look hud vt15 webgl2 high vt15webgl2 vt15high
export PATH="$(cygpath -u "$APPDATA")/fnm/aliases/default:$PATH" DO_NOT_TRACK=1
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")" || exit 1
L=../after.log
for s in "$@"; do
  echo "== BEGIN $s" >> $L
  case "$s" in
    flat) node vt04b.mjs --out ../vt04b/fixed --backend webgpu --preset medium --az 250 --tag fixed --targets post,boulder,boot --acne flat --macro 1 --tip 1 --sweep 1 --views wide >> $L 2>&1 ;;
    slope) node vt04b.mjs --out ../vt04b/fixed --backend webgpu --preset medium --az 200 --slope toward --tag fixed-slope --targets slopePost,slopeBoulder,slopeBoot --acne rampToward --views slope >> $L 2>&1
           node vt04b.mjs --out ../vt04b/fixed --backend webgpu --preset medium --az 200 --slope away --tag fixed-slopeaway --targets none --acne rampAway --views none --suns 60,25,22 >> $L 2>&1 ;;
    look) node lookcheck.mjs --out ../look --preset medium --backend webgpu --tag after --debug 1 >> $L 2>&1 ;;
    hud) node hud.mjs --out ../hud/after --preset low --backend webgpu >> $L 2>&1 ;;
    vt15) node vt15.mjs --out ../vt15/fixed --backend webgpu --preset medium --ts 0.5,0.25,0.75 >> $L 2>&1 ;;
    webgl2) node vt04b.mjs --out ../vt04b/fixed --backend webgl2 --preset medium --az 250 --tag fixed --targets post,boulder,boot --acne flat --tip 1 --views wide >> $L 2>&1 ;;
    high) node vt04b.mjs --out ../vt04b/fixed --backend webgpu --preset high --az 250 --tag fixed --targets post,boulder,boot --acne flat --control 1 --tip 1 --views wide --settle 16 >> $L 2>&1 ;;
    vt15webgl2) node vt15.mjs --out ../vt15/fixed --backend webgl2 --preset medium --ts 0.5,0.25,0.75 >> $L 2>&1 ;;
    vt15high) node vt15.mjs --out ../vt15/fixed --backend webgpu --preset high --ts 0.25,0.75 >> $L 2>&1 ;;
    lookwebgl2) node lookcheck.mjs --out ../look --preset medium --backend webgl2 --tag after >> $L 2>&1 ;;
  esac
  echo "== END $s" >> $L
done
