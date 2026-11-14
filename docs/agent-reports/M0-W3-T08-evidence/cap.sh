#!/usr/bin/env bash
# cap.sh <label> <scene> <preset> <backend> "<query>" [warmup] [duration] [viewport]
# One tools/perf capture against the dev server on 5180; prints a one-line summary.
export PATH="$(cygpath -u "$APPDATA")/fnm/aliases/default:$PATH" DO_NOT_TRACK=1
export MSYS_NO_PATHCONV=1
REPO=/c/Users/caseyn/Downloads/BroswerMoonSweeper
label="$1"; scene="$2"; preset="$3"; backend="$4"; query="$5"; warm="${6:-8}"; dur="${7:-12}"; vp="${8:-1920x1080}"
cd "$REPO/tools/perf" || exit 1
out=$(node node_modules/tsx/dist/cli.mjs src/cli.ts capture --url http://localhost:5180/ --milestone "$label" --scene "$scene" \
  --preset "$preset" --backend "$backend" --runs 1 --warmup "$warm" --duration "$dur" --tier C \
  --out "$REPO/tools/perf/results/M0/t08" --viewport "$vp" ${query:+--query "$query"} ${CAMPATH:+--camera-path "$CAMPATH"} 2>&1)
json=$(echo "$out" | grep -E '\.json$' | tail -1)
if [ -z "$json" ]; then echo "FAILED $label: $out" | tail -5; exit 1; fi
node -e "
const r=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));const a=r.aggregate;const m=k=>a[k]?a[k].median:null;
const f=x=>x==null?'n/a':x.toFixed(1);
console.log(['$label',r.backend,r.preset,'scale='+r.lastSnapshot.env.renderScale,'frame p50/p95='+f(m('frameMsP50'))+'/'+f(m('frameMsP95')),'fps='+f(m('fps')),'gpu p50/p95='+f(m('gpuRenderMsP50'))+'/'+f(m('gpuRenderMsP95')),'cpu p50='+f(m('cpuTotalMsP50')),'draws='+m('drawCalls'),'tris='+m('triangles')].join(' | '));
" "$json"
