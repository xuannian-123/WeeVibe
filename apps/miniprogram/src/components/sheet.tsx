import { useEffect, useRef, useState, type ReactNode } from 'react';
import Taro from '@tarojs/taro';
import { Button, ScrollView, Text, View } from '@tarojs/components';
import { UiIcon } from './ui-icon';
let nextSheet=0;
export function Sheet({title,close,children,footer,className='',overlayClassName=''}:{title:string;close:()=>void;children:ReactNode;footer?:ReactNode;className?:string;overlayClassName?:string}) {
  const [id]=useState(()=>`wv-sheet-${++nextSheet}`);
  const baseHeight=useRef(typeof Taro.getWindowInfo==='function'?Taro.getWindowInfo().windowHeight:700),keyboard=useRef(0);
  const [layout,setLayout]=useState({height:Math.round(baseHeight.current*.65),bottom:0});
  useEffect(()=>{
    let alive=true;
    const measure=()=>{
      if(!alive||typeof Taro.createSelectorQuery!=='function')return;
      const windowHeight=typeof Taro.getWindowInfo==='function'?Taro.getWindowInfo().windowHeight:baseHeight.current;
      const available=Math.max(220,Math.min(windowHeight,baseHeight.current-keyboard.current));
      const bottom=Math.max(0,keyboard.current-Math.max(0,baseHeight.current-windowHeight));
      let headerHeight=74,footerHeight=footer?86:0;
      const query=Taro.createSelectorQuery();
      query.select(`#${id}-header`).boundingClientRect(rect=>{if(rect&&!Array.isArray(rect)&&Number.isFinite(rect.height))headerHeight=rect.height+14;});
      if(footer)query.select(`#${id}-footer`).boundingClientRect(rect=>{if(rect&&!Array.isArray(rect)&&Number.isFinite(rect.height))footerHeight=rect.height;});
      query.select(`#${id}`).boundingClientRect(rect=>{
        if(!alive||!rect||Array.isArray(rect)||!Number.isFinite(rect.height))return;
        const height=Math.max(80,Math.min(rect.height,available*.88-headerHeight-footerHeight));
        setLayout(old=>old.height===height&&old.bottom===bottom?old:{height,bottom});
      }).exec();
    };
    const schedule=()=>typeof Taro.nextTick==='function'?Taro.nextTick(measure):measure();
    const changed=(event:{height:number})=>{keyboard.current=Math.max(0,event.height);schedule();};
    schedule();Taro.onKeyboardHeightChange?.(changed);
    return()=>{alive=false;Taro.offKeyboardHeightChange?.(changed);};
  },[children,footer]);
  return <View className={`wv-overlay wv-polish-overlay ${overlayClassName}`} style={{bottom:`${layout.bottom}px`}} catchMove onClick={close}><View className={`wv-sheet wv-polish-sheet ${className}`} onClick={e=>e.stopPropagation()}>
    <View className="wv-sheet-grip"/><View id={`${id}-header`} className="wv-sheet-header"><Text className="wv-title">{title}</Text><Button className="wv-sheet-close" ariaLabel="关闭弹层" hoverClass="wv-pressed" onClick={close}><UiIcon name="close"/><Text className="wv-sr-only">关闭弹层</Text></Button></View>
    <ScrollView scrollY className="wv-sheet-scroll" style={{height:`${layout.height}px`}}><View id={id} className="wv-sheet-inner">{children}</View></ScrollView>{footer&&<View id={`${id}-footer`} className="wv-sheet-footer">{footer}</View>}
  </View></View>;
}
