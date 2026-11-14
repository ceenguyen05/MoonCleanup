#!/usr/bin/env bash
# Final verification of the shipped shadow-bias rule (flat 1.1-texel normal offset + 0.5-texel depth bias), Medium webgpu,
# plus the look regression numbers and the Low frame cost (M0-visual-checks). Log: ../final.log
export PATH="$(cygpath -u "$APPDATA")/fnm/aliases/default:$PATH" DO_NOT_TRACK=1
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")" || exit 1
L=../final.log
echo "== BEGIN flat" >> $L
node vt04b.mjs --out ../vt04b/final --backend webgpu --preset medium --az 250 --tag final --targets post,boulder,boot --acne flat --tip 1 --views wide >> $L 2>&1
echo "== BEGIN look" >> $L
node lookcheck.mjs --out ../look --preset medium --backend webgpu --tag final >> $L 2>&1
echo "== BEGIN hud" >> $L
node hud.mjs --out ../hud/final --preset low --backend webgpu >> $L 2>&1
echo "== END" >> $L
