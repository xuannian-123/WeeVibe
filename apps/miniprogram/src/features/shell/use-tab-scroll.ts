import { useEffect, useRef } from 'react';
import Taro, { usePageScroll, useDidHide } from '@tarojs/taro';
/** Only presentation offsets; no location, identity, draft or business writes. */
export function useTabScroll(tab:string,subpage:string,source:string|undefined,blocked:boolean) {
  const offsets=useRef<Record<string,number>>({}),owner=useRef(source),epoch=useRef(0),restoring=useRef(false),lastKey=useRef('');
  if(owner.current!==source){owner.current=source;offsets.current={};epoch.current++;}
  const key=`${tab}:${subpage}`;
  if(lastKey.current!==key){lastKey.current=key;restoring.current=true;}
  usePageScroll(e=>{if(!blocked&&!subpage&&!restoring.current)offsets.current[tab]=Math.max(0,e.scrollTop);});
  useDidHide(()=>{epoch.current++;});
  useEffect(()=>{
    if(blocked)return;
    const ticket=++epoch.current;restoring.current=true;
    const restore=()=>{
      if(epoch.current!==ticket||owner.current!==source)return;
      if(typeof Taro.pageScrollTo!=='function'){restoring.current=false;return;}
      void Taro.pageScrollTo({scrollTop:subpage?0:offsets.current[tab]||0,duration:0}).catch(()=>{}).finally(()=>{if(epoch.current===ticket)restoring.current=false;});
    };
    if(typeof Taro.nextTick==='function')Taro.nextTick(restore);else restore();
    return()=>{epoch.current++;};
  },[tab,subpage,source,blocked]);
}
