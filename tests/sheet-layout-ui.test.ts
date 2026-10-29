// @vitest-environment jsdom
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';import {resolve} from 'node:path';
const req=createRequire(resolve(process.cwd(),'apps/miniprogram/package.json')),{createElement,act}=req('react'),{createRoot}=req('react-dom/client');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const h=vi.hoisted(()=>({height:700,header:60,footer:84,keyboard:undefined as any,rect:1000,close:vi.fn(),off:vi.fn()}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro',()=>({default:{getWindowInfo:()=>({windowHeight:h.height}),nextTick:(fn:any)=>fn(),onKeyboardHeightChange:(fn:any)=>{h.keyboard=fn;},offKeyboardHeightChange:h.off,createSelectorQuery:()=>{let selector='';const q:any={select:(value:string)=>{selector=value;return q;},boundingClientRect:(fn:any)=>{fn({height:selector.endsWith('-header')?h.header:selector.endsWith('-footer')?h.footer:h.rect});return q;},exec:()=>{}};return q;}}}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/components',()=>({Image:()=>null,View:(p:any)=>createElement('div',{className:p.className,id:p.id,style:p.style,onClick:p.onClick},p.children),ScrollView:(p:any)=>createElement('div',{className:p.className,style:p.style,'data-scroll':p.scrollY},p.children),Text:(p:any)=>createElement('span',{},p.children),Button:(p:any)=>createElement('button',{'aria-label':p.ariaLabel,onClick:p.onClick},p.children)}));
import {Sheet} from '../apps/miniprogram/src/components/sheet';
let host:HTMLDivElement,root:any;
beforeEach(async()=>{h.height=700;h.header=60;h.footer=84;h.rect=1000;h.close.mockReset();h.off.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(createElement(Sheet,{title:'长内容',close:h.close},'内容')));});
afterEach(async()=>{await act(async()=>root.unmount());document.body.innerHTML='';});
const overlay=()=>host.querySelector('.wv-polish-overlay') as HTMLElement,body=()=>host.querySelector('[data-scroll]') as HTMLElement;
it('caps long content in a native scroll region and keeps a separate reachable close control',async()=>{expect(parseFloat(body().style.height)).toBeLessThan(700);expect(parseFloat(body().style.height)).toBeGreaterThan(100);await act(async()=>host.querySelector('button')!.click());expect(h.close).toHaveBeenCalledOnce();});
it('lifts the sheet when the keyboard overlays an unchanged viewport',async()=>{await act(async()=>h.keyboard({height:300}));expect(overlay().style.bottom).toBe('300px');expect(parseFloat(body().style.height)).toBeLessThan(400);});
it('keeps keyboard clearance while typing changes the sheet content',async()=>{await act(async()=>h.keyboard({height:300}));await act(async()=>root.render(createElement(Sheet,{title:'长内容',close:h.close},'输入后更新的内容')));expect(overlay().style.bottom).toBe('300px');await act(async()=>h.keyboard({height:0}));expect(overlay().style.bottom).toBe('0px');});
it('does not apply the keyboard inset twice when the platform already resizes the viewport',async()=>{h.height=400;await act(async()=>h.keyboard({height:300}));expect(overlay().style.bottom).toBe('0px');expect(parseFloat(body().style.height)).toBeLessThan(400);});

it('reserves real header and footer heights so long titles cannot push the actions below the sheet',async()=>{h.header=140;h.footer=100;await act(async()=>root.render(createElement(Sheet,{title:'很长的地点名称'.repeat(8),close:h.close,footer:createElement('button',{},'固定主操作')},'地点正文')));expect(parseFloat(body().style.height)+h.header+h.footer+14).toBeLessThanOrEqual(700*.88+.01);expect(body().textContent).not.toContain('固定主操作');expect(host.querySelector('.wv-sheet-footer')?.textContent).toContain('固定主操作');expect(host.querySelector('.wv-sheet-header button')).not.toBeNull();});
