// @vitest-environment jsdom
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';import {resolve} from 'node:path';
const req=createRequire(resolve(process.cwd(),'apps/miniprogram/package.json')),{createElement,act}=req('react'),{createRoot}=req('react-dom/client');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const h=vi.hoisted(()=>({auth:{} as Record<string,boolean>,current:true,changed:vi.fn()}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro',()=>({default:{}}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/components',()=>({View:(p:any)=>createElement('div',{},p.children),Text:(p:any)=>createElement('span',{},p.children),Button:(p:any)=>createElement('button',{onClick:()=>p.onOpenSetting({detail:{authSetting:h.auth}})},p.children)}));
import {LocationSettings} from '../apps/miniprogram/src/components/location-settings';
let root:any,host:HTMLDivElement;
beforeEach(async()=>{h.auth={};h.current=true;h.changed.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(createElement(LocationSettings,{current:()=>h.current,changed:h.changed})));});
afterEach(async()=>{await act(async()=>root.unmount());document.body.innerHTML='';});
it('recognizes a returned precise-location grant',async()=>{h.auth={'scope.userLocation':true};await act(async()=>host.querySelector('button')!.click());expect(h.changed).toHaveBeenCalledWith(true);});
it.each([false,undefined])('does not accept precise consent when precise consent is %s',async granted=>{h.auth={'scope.userFuzzyLocation':true};if(granted!==undefined)h.auth['scope.userLocation']=granted;await act(async()=>host.querySelector('button')!.click());expect(h.changed).toHaveBeenCalledWith(false);});
it('ignores a native settings return to an expired source',async()=>{h.auth={'scope.userLocation':true};h.current=false;await act(async()=>host.querySelector('button')!.click());expect(h.changed).not.toHaveBeenCalled();});
