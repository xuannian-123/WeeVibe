import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// Offline review of the actual intake controller. No requests leave this package.
const root = process.cwd(), mini = createRequire(resolve(root, 'apps/miniprogram/package.json'));
const esbuild = createRequire(mini.resolve('vite'))('esbuild'), postcss = mini('postcss');
const out = resolve(root, 'outputs/design-c-interview-20261029');
await mkdir(out, { recursive: true });
const componentAdapter = resolve(out, 'components.cjs'), nativeAdapter = resolve(out, 'native.cjs');
await writeFile(componentAdapter, `const React=require(${JSON.stringify(mini.resolve('react'))}),h=React.createElement;
exports.View=p=>h('div',{id:p.id,className:p.className,style:p.style,onClick:p.onClick},p.children);
exports.Text=p=>h('span',{className:p.className,style:p.style},p.children);
exports.Button=p=>h('button',{className:p.className,style:p.style,disabled:p.disabled,'aria-label':p.ariaLabel,onClick:p.onClick},p.children);
exports.Image=p=>h('img',{className:p.className,src:p.src,alt:'',style:p.style});
exports.ScrollView=p=>{const r=React.useRef();React.useEffect(()=>{if(p.scrollIntoView)requestAnimationFrame(()=>{const target=document.getElementById(p.scrollIntoView),scroller=r.current;if(target&&scroller)scroller.scrollTop=target.offsetTop-scroller.offsetTop})},[p.scrollIntoView]);return h('div',{ref:r,className:p.className,style:{...p.style,overflowY:p.scrollY?'auto':undefined}},p.children)};
exports.Input=p=>h('input',{className:p.className,value:p.value,placeholder:p.placeholder,disabled:p.disabled,maxLength:p.maxlength,inputMode:p.type==='digit'?'decimal':undefined,onInput:e=>p.onInput?.({detail:{value:e.currentTarget.value}}),onKeyDown:e=>{if(e.key==='Enter')p.onConfirm?.({detail:{value:e.currentTarget.value}})}});
exports.Textarea=p=>h('textarea',{className:p.className,value:p.value,placeholder:p.placeholder,disabled:p.disabled,maxLength:p.maxlength,onInput:e=>p.onInput?.({detail:{value:e.currentTarget.value}})});
exports.Picker=p=>h('label',{className:'preview-date'},h('input',{type:p.mode==='date'?'date':'text',value:p.value,disabled:p.disabled,onChange:e=>p.onChange?.({detail:{value:e.currentTarget.value}})}),p.children);
`);
await writeFile(nativeAdapter, `const callbacks=new Set;exports.__esModule=true;exports.default={getWindowInfo:()=>({windowHeight:innerHeight}),nextTick:f=>requestAnimationFrame(f),onKeyboardHeightChange:f=>callbacks.add(f),offKeyboardHeightChange:f=>callbacks.delete(f),getStorageSync:()=>'',showToast:()=>Promise.resolve(),createSelectorQuery:()=>{let sel;const tasks=[];const q={select:s=>(sel=s,q),boundingClientRect:fn=>{const s=sel;tasks.push(()=>fn(document.querySelector(s)?.getBoundingClientRect()||null));return q},exec:()=>requestAnimationFrame(()=>tasks.forEach(f=>f()))};return q}};exports.useDidHide=()=>{};exports.useDidShow=()=>{};exports.useUnload=()=>{};window.previewKeyboard=height=>callbacks.forEach(fn=>fn({height}));`);
const stubs = new Map([
  ['apps/miniprogram/src/platform/api', `export const getToken=()=> 'offline-review'; export const transport=()=>Promise.reject(Error('离线核对不访问业务接口'));`],
  ['apps/miniprogram/src/platform/account-api', `export const requestAccount=async()=>({profile:{nickname:'示例小林'}});`],
  ['apps/miniprogram/src/platform/use-map-picker', `export const useMapPicker=()=>async()=>{throw Error('离线核对不打开微信地图，请在小程序中验证。')};`],
  ['apps/miniprogram/src/platform/location-permission', `export const LOCATION_SCOPE='scope.userLocation';export const requireLocationPermission=async()=>{throw Error('离线核对不读取真实定位。')};export const readPreciseLocation=requireLocationPermission;export const needsLocationSettings=()=>false;export const openLocationSettings=requireLocationPermission;`],
  ['apps/miniprogram/src/features/shell/location-api', `export const searchForSession=async()=>{throw Error('离线核对不查询真实地址，请手动填写示例地址。')};export const locationError=e=>e.message;`],
  ['apps/miniprogram/src/features/gatherings/client', `export const organizeGathering=async(session,publicInput,guard)=>{guard?.();window.reviewRequests.push(publicInput);if(window.reviewAI==='error')throw Error('示例：整理服务暂不可用，回答已保留。');if(window.reviewAI==='pending')return new Promise(()=>{});return {summary:'示例整理：周末下午一起吃火锅、唱歌，想轻松一点，不喝酒。请逐项确认哪些已经确定。',source:'ai',blocks:[]}};export const gatheringMessage=e=>e.message;`],
]);
const stubByPath = new Map([...stubs].map(([path, code]) => [resolve(root, path).toLowerCase(), code]));
const offlinePlugin = { name: 'offline-native-and-api-boundary', setup(build) {
  build.onResolve({ filter: /^\./ }, args => {
    const target = resolve(args.resolveDir, args.path).replace(/\.(tsx?|jsx?)$/, '').toLowerCase();
    if (stubByPath.has(target)) return { path: target, namespace: 'offline' };
  });
  build.onLoad({ filter: /.*/, namespace: 'offline' }, args => ({ contents: stubByPath.get(args.path), loader: 'js' }));
}};
await esbuild.build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{emptyGatheringIntake}from'@weevibe/contracts';
import{GatheringIntakeEditor}from'./apps/miniprogram/src/features/gatherings/intake-editor';
window.reviewRequests=[];window.reviewAI=new URLSearchParams(location.search).get('ai')||'ok';
function Preview(){const[saved,setSaved]=useState(false);const initial=emptyGatheringIntake();initial.public.activity_nickname='示例小林';return <><div className="preview-label">设计核对 · 全部为示例 · 不调用真实 AI 或微信</div><div className="preview-native"><span>9:41</span><b>WeeVibe</b><i>•••　⊙</i></div><main className="gg-screen gg-screen-designed"><GatheringIntakeEditor initial={initial} session="offline-review" date="2030-11-10" done={value=>{window.reviewSaved=value;setSaved(true)}} cancel={()=>{window.reviewCancelled=true;location.href='index.html'}}/>{saved&&<div className="preview-result">示例内容已返回本地草稿；没有创建活动或发送请求。<button onClick={()=>location.reload()}>重新核对</button></div>}</main></>};createRoot(document.getElementById('root')).render(<Preview/>);
` }, outfile: resolve(out, 'preview.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', plugins: [offlinePlugin], alias: { '@tarojs/components': componentAdapter, '@tarojs/taro': nativeAdapter, react: dirname(mini.resolve('react/package.json')), 'react-dom': dirname(mini.resolve('react-dom/package.json')), '@weevibe/contracts': resolve(root, 'packages/contracts/src/index.ts') }, loader: { '.css': 'empty', '.png': 'file', '.jpg': 'file' }, assetNames: 'assets/[name]-[hash]', logLevel: 'silent' });
const files=['apps/miniprogram/src/app.css','apps/miniprogram/src/design-c.css','apps/miniprogram/src/features/gatherings/gatherings.css','apps/miniprogram/src/features/gatherings/nickname-step.css','apps/miniprogram/src/features/design-c/fonts.css','apps/miniprogram/src/features/design-c/foundation.css','apps/miniprogram/src/features/design-c/interview.css','apps/miniprogram/src/features/design-c/interview-inputs.css','apps/miniprogram/src/features/design-c/interview-review.css'];
const parsed=postcss.parse((await Promise.all(files.map(f=>readFile(resolve(root,f),'utf8')))).join('\n').replace("@import './fonts.css';",''));
parsed.walkDecls(declaration=>{declaration.value=declaration.value.replace(/url\([^)]*\)|(-?[\d.]+)px/g,(whole,n)=>n===undefined?whole:'calc(100vw * '+Number(n)/750+')')});
const css=parsed.toString().replaceAll('>text','>span').replaceAll('>view','>div').replaceAll('>image','>img')+`
*{box-sizing:border-box}body{margin:0;background:#f8f6f0;color:#222;font:14px/1.65 Arial,'Microsoft YaHei',sans-serif}button,input,textarea{font:inherit}button{cursor:pointer}input,textarea{min-width:0;outline-color:#b7a4f8}.preview-label{font:10px/20px Arial;background:#222;color:white;text-align:center;height:20px}.preview-native{height:74px;background:white;position:relative;padding:6px 20px}.preview-native>span{font:bold 11px Arial}.preview-native>b{display:block;text-align:center;font-weight:500;padding-top:8px;font-size:16px}.preview-native>i{position:absolute;bottom:10px;right:12px;border:1px solid #eee;border-radius:20px;padding:1px 12px;font-style:normal}.c-interview{top:94px}.preview-date{display:block}.preview-date>input{width:100%;padding:9px 6px;border-radius:8px;border:1px solid #d7d0c3;background:#fffdf8}.preview-date>.ci-picker{display:none}.preview-result{position:fixed;inset:94px 0 0;z-index:90;padding:35px;background:#f8f6f0}.preview-result button{display:block;margin-top:20px;padding:12px 25px;border:0;border-radius:25px;background:#a7f05a}.ci-composer-input{border:0;outline:none}
`;
await writeFile(resolve(out,'preview.css'),css);
await writeFile(resolve(out,'screen.html'),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>小橘头 · 实际组件核对</title><link rel="stylesheet" href="preview.css"><div id="root"></div><script src="preview.js"></script></html>');
await writeFile(resolve(out,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>小橘头 · 五题对话核对</title><style>*{box-sizing:border-box}body{margin:0;background:#eae7df;color:#222;font:14px/1.8 Arial,'Microsoft YaHei',sans-serif}main{max-width:1000px;margin:32px auto;padding:0 24px}h1{font-size:26px}a{color:#222}li{margin:10px 0}.links{display:flex;gap:15px;flex-wrap:wrap}.links a{padding:10px 24px;background:#a7f05a;border-radius:30px;text-decoration:none}iframe{display:block;width:390px;height:844px;border:2px solid #222;border-radius:20px;background:#f8f6f0;max-width:100%;margin:25px auto}p{font-size:13px;color:#655e54}</style><main><h1>小橘头 · 五题对话核对</h1><p>直接渲染当前小程序中的填写控制器与新 C 风格组件。昵称是前置步骤，出游问题仍为原来的五题。本包全部为示例，不连接账号、业务 API、地图、定位或真实模型。</p><div class="links"><a href="screen.html">正常示例 ↗</a><a href="screen.html?ai=error">整理失败示例 ↗</a><a href="screen.html?ai=pending">整理等待示例 ↗</a></div><ol><li>选择“小橘头（AI问答）”，确认示例昵称后开始五题。</li><li>可在题内选择或直接输入回答；不明确的回答会保留原文并继续询问。</li><li>私人出发地、预算只写本人栏位。完成后调用示例整理，再由本人逐项确定。</li><li>历史回答可以修改；“愿意配合”与“先留待定”是明确选择，不表示同意最终安排。</li></ol><iframe title="小橘头实际组件示例" src="screen.html"></iframe><p>尚未更新微信手机预览码。微信原生键盘、地图、授权及真实接口仍需小程序核对。</p></main></html>`);
await writeFile(resolve(out,'manifest.json'),JSON.stringify({kind:'actual_intake_controller_offline_review',sample_data_only:true,real_ai:false,business_api:false,wechat_native_calls:false,phone_verified:false,questions:5},null,2));
console.log(JSON.stringify({out,real_ai:false,business_api:false}));
