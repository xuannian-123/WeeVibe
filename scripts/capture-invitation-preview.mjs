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
  for (const [mode, width] of [['guest', 375], ['participant', 375], ['manager', 430], ['long', 320], ['card', 375]]) {
    await page('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
    await page('Page.navigate', { url: `${pathToFileURL(path.join(output, 'index.html')).href}?view=${mode}` });
    const readiness = await page('Runtime.evaluate', { expression: `(async()=>{await document.fonts.ready;for(let i=0;i<100;i++){if(document.querySelector('#root')?.children.length&&[...document.images].every(img=>img.complete)&&(${JSON.stringify(mode)}!=='card'||document.querySelector('#root>img'))){await new Promise(r=>setTimeout(r,150));return true}await new Promise(r=>setTimeout(r,50))}return false})()`, awaitPromise: true, returnByValue: true });
    if (!readiness.result.value) throw new Error(`PREVIEW_NOT_READY:${mode}`);
    if (mode === 'participant') {
      await page('Runtime.evaluate', { expression: `document.querySelector('[aria-label="预览水豚"]')?.click()` });
      await pause(100);
    }
    const metrics = await page('Runtime.evaluate', { expression: `JSON.stringify({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,images:[...document.images].filter(img=>img.naturalWidth>0).length})`, returnByValue: true });
    const data = JSON.parse(metrics.result.value);
    if (data.viewport !== width || data.scrollWidth > width) throw new Error(`HORIZONTAL_OVERFLOW:${mode}:${JSON.stringify(data)}`);
    const capture = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.min(data.height, 16000), scale: 1 } });
    await writeFile(path.join(output, `${mode}-${width}.png`), Buffer.from(capture.data, 'base64'));
    evidence.push({ mode, width, ...data });
  }
  await writeFile(path.join(output, 'layout-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
  await send('Browser.close');
} finally { socket?.close(); browser.kill(); }
