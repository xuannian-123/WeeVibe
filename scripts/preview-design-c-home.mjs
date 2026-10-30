import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
const root = process.cwd();
const mini = createRequire(resolve(root, 'apps/miniprogram/package.json'));
const esbuild = createRequire(mini.resolve('vite'))('esbuild');
const out = resolve(root, 'outputs/design-c-home-faithful');
await mkdir(out, { recursive: true });
const adapter = resolve(out, 'taro-adapter.cjs');
await writeFile(adapter, `const React=require(${JSON.stringify(mini.resolve('react'))});
const h=React.createElement;
exports.View=p=>h('div',{className:p.className,style:p.style,onClick:p.onClick},p.children);
exports.Text=p=>h('span',{className:p.className,style:p.style},p.children);
exports.Button=p=>h('button',{className:p.className,style:p.style,onClick:p.onClick,disabled:p.disabled,'aria-label':p.ariaLabel},p.children);
exports.Image=p=>h('img',{className:p.className,src:p.src,alt:p.ariaHidden?'':'示例图片',style:{...p.style,objectFit:p.mode==='aspectFill'?'cover':p.mode==='aspectFit'?'contain':'fill'},onError:p.onError});
`);
const sharp = createRequire(resolve(root, 'apps/web/package.json'))('sharp');
await mkdir(resolve(out, 'assets'), { recursive: true });
for (const [name,left] of [['sample-park',0],['sample-coffee',480]]) {
  await sharp(resolve(root,'apps/miniprogram/src/assets/design-c/scene-photos.jpg')).extract({ left, top: 320, width: 480, height: 320 }).toFile(resolve(out,`assets/${name}.jpg`));
}
await esbuild.build({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {CHeader,CNavigation} from './apps/miniprogram/src/features/design-c/chrome';
import {CGoHome} from './apps/miniprogram/src/features/design-c/home';
import {CActivityOverview} from './apps/miniprogram/src/features/design-c/activity-overview';
import {emptyAccountFixture,accountVenue} from './tests/account-fixtures';
const activity={activity_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',title:'周末湖边野餐（示例）',starts_at:'2030-01-05T06:00:00Z',ends_at:'2030-01-05T09:00:00Z',timezone:'Asia/Shanghai',phase:'upcoming',time_scope:'activity',location:'湖边集合点（示例）',cancelled:false,participation_cancelled:false,is_manager:true,joined_segment_count:1,exited_segment_count:0,pending_application_count:0,awaiting_acceptance:false};
const preparation={id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',kind:'friend',title:'周五朋友小聚（示例）',date:'2030-01-06',stage:'collecting',is_owner:true,has_responded:true,member_count:2,updated_at:'2030-01-01T00:00:00Z'};
const account={...emptyAccountFixture(),activity_records:[activity],favorites:[{...accountVenue(),provider_id:'sample-park',name:'湖边公园（示例）',district:'示例湖滨区域',photos:[{url:'assets/sample-park.jpg'}]},{...accountVenue(),provider_id:'sample-coffee',name:'街角咖啡（示例）',district:'示例城区',photos:[{url:'assets/sample-coffee.jpg'}]}]};
function Preview(){const[state,setState]=useState(new URLSearchParams(location.search).get('state')||'normal');const[overview,setOverview]=useState(false);const[note,setNote]=useState('');const message=t=>{setNote(t);setTimeout(()=>setNote(''),2500)};return <><div className="review-banner">实际组件离线预览 · 全部为示例 <select aria-label="示例状态" value={state} onChange={e=>{setState(e.target.value);setOverview(false)}}><option value="normal">正常</option><option value="empty">空列表</option><option value="error">读取失败</option><option value="signedout">未登录</option><option value="long">长内容</option></select></div><div className="native-frame"><span>9:41</span><b>WeeVibe</b><i>•••　⊙</i></div><div className="wv-shell c-shell">{!overview&&<CHeader city="苏州市" chooseCity={()=>message('城市弹层将在下一屏对照实现')}/>}{overview?<CActivityOverview account={account} initialGroup="all" preparations={[preparation]} busy={false} error="" refresh={()=>{}} openActivity={()=>message('示例：进入正式活动，保留真实路由边界')} openPreparation={()=>message('示例：进入筹备流程')} back={()=>setOverview(false)} more={()=>message('示例：已保存邀请／通过编号打开')}/>:<CGoHome account={state==='error'?undefined:state==='empty'?{...account,activity_records:[],favorites:[]}:state==='long'?{...account,activity_records:[{...activity,title:'很长的活动名称示例：周末和朋友一起去湖边散步再吃晚餐'}]}:account} signedIn={state!=='signedout'} busy={false} login={()=>message('离线预览不调用微信登录')} refresh={()=>setState('normal')} friend={()=>message('朋友出游入口保留，创建弹层下一屏核对')} team={()=>message('团建入口保留，创建弹层下一屏核对')} all={()=>setOverview(true)} ideas={()=>message('灵感页面将在下一屏对照实现')} openActivity={()=>message('示例：进入正式活动')} openPreparation={()=>message('示例：进入筹备流程')} preparations={state==='empty'||state==='error'||state==='signedout'?[]:[preparation]} retryPreparations={()=>{}} preview={()=>message('地点详情将在下一屏对照实现')}/>}
<CNavigation selected="go" unread={1} change={tab=>message(tab==='go'?'当前为首页':tab+' 页面将在后续逐屏替换')} create={()=>message('创建弹层将在下一屏对照实现')}/></div>{note&&<div className="preview-toast">{note}</div>}</>};createRoot(document.getElementById('root')).render(<Preview/>);
` },
  outfile: resolve(out, 'preview.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
  alias: { '@tarojs/components': adapter, react: dirname(mini.resolve('react/package.json')), 'react-dom': dirname(mini.resolve('react-dom/package.json')) },
  loader: { '.css': 'empty', '.png': 'file', '.jpg': 'file' }, assetNames: 'assets/[name]-[hash]', logLevel: 'silent',
});
const files = ['apps/miniprogram/src/app.css','apps/miniprogram/src/design-c.css','apps/miniprogram/src/pages/index/home.css','apps/miniprogram/src/features/shell/navigation.css','apps/miniprogram/src/features/shell/polish.css','apps/miniprogram/src/features/design-c/fonts.css','apps/miniprogram/src/features/design-c/foundation.css'];
let css = (await Promise.all(files.map(file => readFile(resolve(root,file),'utf8')))).join('\n').replace('@import \'./fonts.css\';','');
const postcss = mini('postcss');
const parsed = postcss.parse(css);
parsed.walkDecls(declaration => { declaration.value = declaration.value.replace(/url\([^)]*\)|(-?[\d.]+)px/g,(whole,number)=>number === undefined ? whole : `calc(100vw * ${Number(number) / 750})`); });
css = parsed.toString().replaceAll('>text','>span');
css += `\n*{box-sizing:border-box}body{margin:0;background:#f8f6f0;color:#222;font:14px/1.65 Arial,'Microsoft YaHei',sans-serif}button{cursor:pointer}img{vertical-align:middle}button:disabled{opacity:.5}button:focus-visible{outline:2px solid #b7a4f8;outline-offset:3px}.review-banner{font:10px/1.5 Arial,sans-serif;padding:5px 9px;background:#222;color:white;display:flex;gap:8px;justify-content:space-between;align-items:center}.review-banner select{background:#fff;color:#222;border:0;border-radius:3px;font-size:10px}.native-frame{height:74px;position:relative;background:white;padding:6px 20px}.native-frame>span{font:bold 11px Arial}.native-frame>b{display:block;text-align:center;font-size:16px;font-weight:500;padding-top:8px}.native-frame>i{position:absolute;right:12px;bottom:10px;font-size:15px;border:1px solid #eee;border-radius:20px;padding:1px 12px;font-style:normal}.preview-toast{position:fixed;bottom:95px;left:20px;right:20px;background:#222e;color:#fff;padding:13px;border-radius:12px;text-align:center;font-size:12px;z-index:50}`;
await writeFile(resolve(out,'preview.css'),css);
await writeFile(resolve(out,'index.html'),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WeeVibe · 首页实际组件核对</title><link rel="stylesheet" href="preview.css"><div id="root"></div><script src="preview.js"></script></html>');
await writeFile(resolve(out,'说明.txt'),'此预览直接渲染本次小程序 React 展示组件，浏览器仅替换 Taro 原生标签。全部数据为离线示例，不连接真实账号、微信或业务接口。当前完成首页、底部导航及活动列表；其余入口显示接入说明，不冒充整套前端完成。真实字体、图片、滚动和安全区仍需微信手机验证。');
console.log(JSON.stringify({ preview: resolve(out,'index.html'), source: 'actual_new_React_components', business_api_called: false }));
