#!/usr/bin/env bash
# VT-M0-12 harness matrix (final re-run): tools/screenshots capture.ts against the capture Vite on 5197, real-GPU lane.
# Out: docs/visual-reviews/M0/final/. Log: ../final-rerun/harness.log
export PATH="$(cygpath -u "$APPDATA")/fnm/aliases/default:$PATH" DO_NOT_TRACK=1 MSYS_NO_PATHCONV=1
R=/c/Users/caseyn/Downloads/BroswerMoonSweeper
cd $R/tools/screenshots || exit 1
L=$R/docs/visual-reviews/M0/checks/final-rerun/harness.log
O=$R/docs/visual-reviews/M0/final
U=http://localhost:5197/
cap() { echo "== BEGIN $* $(date +%H:%M:%S)" >> $L; node node_modules/tsx/dist/cli.mjs src/capture.ts --lane gpu --url $U --out $O --step 30 "$@" >> $L 2>&1; echo "exit $?" >> $L; }
cap S01,S02,S03,S05,S06 --tier B --preset medium --backend webgpu --scale floor --tod noon
cap S01 --tier B --preset medium --backend webgpu --scale floor --tod dawn
cap S01,S02,S03,S05,S06 --tier C --preset low --backend webgl2 --scale floor --tod noon
cap hud-test --tier B --preset low --backend webgpu --scale floor --tod noon --hud hud --dpr 1 --width 1920 --height 1080
cap hud-test --tier B --preset low --backend webgpu --scale floor --tod noon --hud hud --dpr 1.5 --width 1280 --height 720
cap hud-test --tier B --preset low --backend webgpu --scale floor --tod noon --hud hud --dpr 2 --width 1280 --height 800
echo "== measure tests $(date +%H:%M:%S)" >> $L
pnpm --filter @moon-cleanup/screenshots test >> $L 2>&1
echo "== END $(date +%H:%M:%S)" >> $L
