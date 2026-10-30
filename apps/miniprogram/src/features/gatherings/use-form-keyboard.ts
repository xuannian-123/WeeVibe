import {useEffect,useRef,useState} from 'react';
import Taro from '@tarojs/taro';

// Some clients resize the window; others overlay it. Offset only the remainder.
export function useGatheringFormKeyboard(){
  const height=()=>typeof Taro.getWindowInfo==='function'?Taro.getWindowInfo().windowHeight:700;
  const base=useRef(height()),keyboard=useRef(0);
  const [layout,setLayout]=useState({bottom:0,open:false});
  useEffect(()=>{
    let active=true;
    const measure=()=>{if(!active)return;const current=height();if(!keyboard.current)base.current=Math.max(base.current,current);setLayout({bottom:Math.max(0,keyboard.current-Math.max(0,base.current-current)),open:keyboard.current>0});};
    const changed=(event:{height:number})=>{keyboard.current=Math.max(0,event.height);measure();Taro.nextTick?.(measure);};
    Taro.onKeyboardHeightChange?.(changed);Taro.onWindowResize?.(measure);
    return()=>{active=false;Taro.offKeyboardHeightChange?.(changed);Taro.offWindowResize?.(measure);};
  },[]);
  return layout;
}
