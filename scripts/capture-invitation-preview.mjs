// Capture only our synthetic local preview in an isolated, preinstalled headless Chrome.
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'outputs/invitation-preview');
const chrome = process.argv[2] || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
await access(path.join(output, 'index.html'));
const profile = path.join(output, `chrome-capture-${Date.now()}`);
await mkdir(profile, { recursive: true });
const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await pause(100); }
  }
  if (!port) throw new Error('HEADLESS_CHROME_NOT_READY');
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0; const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data); const request = pending.get(message.id);
    if (request) { pending.delete(message.id); clearTimeout(request.timer); message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result); }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP_TIMEOUT:${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const page = (method, params) => send(method, params, sessionId);
  await page('Page.enable');
  const evidence = [];
  for (const [mode, width, expanded = false] of [['guest', 375], ['pending', 375], ['participant', 375], ['changed', 375], ['cancelled', 375], ['manager', 430], ['long', 320], ['card', 375], ['guest', 1440], ['guest', 375, true], ['long', 320, true], ['manager', 430, true], ['cancelled', 375, true], ['guest', 1440, true]]) {
    await page('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
    await page('Page.navigate', { url: `${pathToFileURL(path.join(output, 'index.html')).href}?view=${mode}${expanded ? '&expanded=1' : ''}` });
    const readiness = await page('Runtime.evaluate', { expression: `(async()=>{await document.fonts.ready;for(let i=0;i<100;i++){if(document.querySelector('#root')?.children.length&&[...document.images].every(img=>img.complete)&&(${JSON.stringify(mode)}!=='card'||document.querySelector('#root>img'))){await new Promise(r=>setTimeout(r,150));return true}await new Promise(r=>setTimeout(r,50))}return false})()`, awaitPromise: true, returnByValue: true });
    if (!readiness.result.value) throw new Error(`PREVIEW_NOT_READY:${mode}`);
    if (mode === 'guest' && !expanded) {
      const clicked = await page('Runtime.evaluate', { expression: `(async()=>{[...document.querySelectorAll('button')].find(b=>b.textContent?.startsWith('登录并选择参加环节'))?.click();await new Promise(r=>setTimeout(r,80));const ok=document.body.textContent.includes('先登录，再申请');[...document.querySelectorAll('button')].find(b=>b.textContent==='返回活动')?.click();await new Promise(r=>setTimeout(r,80));return ok&&!!document.querySelector('.iv-title')})()`, awaitPromise:true, returnByValue:true });
      if (!clicked.result.value) throw new Error('PREVIEW_NAVIGATION_FAILED');
    }
    if(expanded){const ready=await page('Runtime.evaluate',{expression:`(async()=>{for(let i=0;i<50;i++){if(document.querySelector('.ia-arrangement'))return true;await new Promise(r=>setTimeout(r,50))}return false})()`,awaitPromise:true,returnByValue:true});if(!ready.result.value)throw new Error('EXPANDED_NOT_READY');}
    const metrics = await page('Runtime.evaluate', { expression: `JSON.stringify({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,images:[...document.images].filter(img=>img.naturalWidth>0).length})`, returnByValue: true });
    const data = JSON.parse(metrics.result.value);
    if (data.viewport !== width || data.scrollWidth > width) throw new Error(`HORIZONTAL_OVERFLOW:${mode}:${JSON.stringify(data)}`);
    const capture = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.min(data.height, 16000), scale: 1 } });
    await writeFile(path.join(output, `${mode}${expanded ? '-expanded' : ''}-${width}.png`), Buffer.from(capture.data, 'base64'));
    if(expanded){
      const check=await page('Runtime.evaluate',{expression:`JSON.stringify({legacy:!!document.querySelector('.iv-expanded .activity-itinerary'),cards:document.querySelectorAll('.ia-card').length,top:document.querySelector('.ia-arrangement').getBoundingClientRect().top+scrollY,height:document.querySelector('.ia-arrangement').getBoundingClientRect().height})`,returnByValue:true});
      const expandedData=JSON.parse(check.result.value);if(expandedData.legacy||expandedData.cards===0)throw new Error('LEGACY_ARRANGEMENT_DETECTED');
      if(mode==='guest'&&width===375){const crop=await page('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:expandedData.top,width,height:expandedData.height,scale:1}});await writeFile(path.join(output,'expanded-detail-375.png'),Buffer.from(crop.data,'base64'));}
    }
    evidence.push({ mode, width, expanded, ...data });
  }
  await writeFile(path.join(output, 'layout-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
  await send('Browser.close');
} finally { socket?.close(); browser.kill(); }
