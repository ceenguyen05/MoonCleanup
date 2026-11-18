import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const repo = process.cwd();
const { chromium } = await import(pathToFileURL(path.join(repo, 'tools/screenshots/node_modules/@playwright/test/index.mjs')));
const out = path.join(repo, 'docs/agent-reports/CODEX-outpost-evidence');
const log = {errors:[], requests:[]}; const flush=()=>fs.writeFileSync(path.join(out,'capture-live.json'),JSON.stringify(log,null,2));
const browser = await chromium.launch({headless:true, channel:'chrome', args:['--enable-unsafe-webgpu','--enable-features=Vulkan,WebGPU','--ignore-gpu-blocklist']});
try {
 const page = await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
 page.on('console',m=>{if(['error','warning'].includes(m.type())){log.errors.push(m.type()+': '+m.text());flush();}});
 page.on('pageerror',e=>log.errors.push(String(e)));
 page.on('response',r=>{if(r.url().includes('basis_')||r.url().includes('boreal_'))log.requests.push({url:r.url(),status:r.status()});});
 await page.route('**/src/app/outpost.ts',async route=>{
  const response=await route.fetch();
  const body=(await response.text()).replace('roots.world.add(view.root);','roots.world.add(view.root); window.__outpostCapture = {view, kit, roots, renderer};');
  await route.fulfill({response,body});
 });
 await page.goto('http://127.0.0.1:5294/?perf=1&preset=medium&dynres=off',{timeout:45000});
 await page.waitForFunction(()=>window.__outpostCapture?.view.root.children.length===13,null,{timeout:30000});
 await page.waitForTimeout(3000);
 log.info=await page.evaluate(async()=>{
  const p=window.__outpostCapture;
  const adapter=await navigator.gpu.requestAdapter();
  const textures=[];
  p.view.root.traverse(n=>{if(n.material?.map&&!textures.some(t=>t.uuid===n.material.map.uuid)){const t=n.material.map;textures.push({uuid:t.uuid,compressed:t.isCompressedTexture,format:t.format,width:t.image?.width,height:t.image?.height});}});
  return {gpu:adapter?.info, pieces:p.view.root.children.length,textures, game:window.__mcGameplay?.(),info:window.__mcInfo?.()};
 });
 await page.screenshot({path:path.join(out,'gameplay.png')});
 await page.addStyleTag({content:'body > #root { } [data-testid="hud-root"], [role="dialog"] { visibility: hidden !important; }'});
 await page.evaluate(()=>{
  const {roots,view}=window.__outpostCapture;
  const c=roots.camera,centre=view.root.children[0].position;
  const set=c.position.set.bind(c.position),look=c.lookAt.bind(c);
  c.position.set=()=>set(centre.x+28,18,centre.z+32);
  c.lookAt=()=>look(centre.x,1,centre.z);
 });
 await page.waitForTimeout(2500);
 await page.screenshot({path:path.join(out,'overview.png')});
 log.finalErrors=log.errors.filter(e=>e.startsWith('error')||e.includes('Error'));
} catch(e){log.failure=String(e);process.exitCode=1;}
finally{fs.writeFileSync(path.join(out,'capture.json'),JSON.stringify(log,null,2));await browser.close();}


