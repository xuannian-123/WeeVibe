import {useEffect,useState,type ReactNode} from 'react';
import Taro from '@tarojs/taro';
import {View} from '@tarojs/components';
export function GatheringFormFooter({children}:{children:ReactNode}){
  const[keyboard,setKeyboard]=useState(0);
  useEffect(()=>{const changed=(event:{height:number})=>setKeyboard(Math.max(0,event.height));Taro.onKeyboardHeightChange?.(changed);return()=>Taro.offKeyboardHeightChange?.(changed);},[]);
  return <View className="gg-form-footer" style={{bottom:`${keyboard}px`}}>{children}</View>;
}
