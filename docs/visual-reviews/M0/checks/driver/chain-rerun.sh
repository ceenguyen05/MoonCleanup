#!/usr/bin/env bash
# M0-visual-check-final "final re-run" (round-3 code): HUD, VT-07, scenes (comb / S06 pool), 04b slope / sweep / webgl2, harness.
# Own capture Vite on 5197 (watch/HMR off). Log: ../final-rerun/chain.log
export PATH="$(cygpath -u "$APPDATA")/fnm/aliases/default:$PATH" DO_NOT_TRACK=1 MSYS_NO_PATHCONV=1 MC_BASE=http://localhost:5197/
cd "$(dirname "$0")" || exit 1
O=../final-rerun
mkdir -p $O
L=$O/chain.log
step() { echo "== BEGIN $1 $(date +%H:%M:%S)" >> $L; }
step hud;   node hud10.mjs --out $O/hud --backend webgpu --glass 1 >> $L 2>&1
step vt07;  for c in "medium webgpu" "low webgpu" "low webgl2"; do set -- $c
              node ../../../../../apps/client/src/visuals/lookdev/s02-run.mjs --scene s02 --backend $2 --preset $1 --port 5197 --page / --variants noon,dawn --out $O/vt07/$1 >> $L 2>&1; done
step scenes; for c in "medium webgpu" "low webgpu" "low webgl2"; do set -- $c
              node r2b-ground.mjs --out $O/scenes --part scenes --preset $1 --backend $2 --grounds regolith >> $L 2>&1; done
step vt04b-slope-medium; node vt04b.mjs --out $O/vt04b --backend webgpu --preset medium --az 200 --slope toward --tag slope --targets slopePost,slopeBoulder,slopeBoot --acne rampToward --views slope >> $L 2>&1
step vt04b-sweep-medium; node vt04b.mjs --out $O/vt04b --backend webgpu --preset medium --az 250 --tag sweep --suns 4,1 --targets post --acne none --views none --sweep 1 >> $L 2>&1
step vt04b-flat-webgl2;  node vt04b.mjs --out $O/vt04b --backend webgl2 --preset low --az 250 --tag flat --targets post,boulder,boot --acne flat --tip 1 --views wide >> $L 2>&1
step vt04b-slope-webgl2; node vt04b.mjs --out $O/vt04b --backend webgl2 --preset low --az 200 --slope toward --tag slope --targets slopePost,slopeBoulder,slopeBoot --acne rampToward --views slope >> $L 2>&1
step vt04b-sweep-webgl2; node vt04b.mjs --out $O/vt04b --backend webgl2 --preset low --az 250 --tag sweep --suns 4,1 --targets post --acne none --views none --sweep 1 >> $L 2>&1
echo "== END $(date +%H:%M:%S)" >> $L
