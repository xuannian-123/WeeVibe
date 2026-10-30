import {Button,Text,View} from '@tarojs/components';
import {useEffect} from 'react';
import Taro from '@tarojs/taro';
import {CIcon,CWordmark} from '../design-c/chrome';
import './friend-start.css';

export function GatheringFlowHeader({back,disabled=false,label='返回',stepKey='screen'}:{back:()=>void;disabled?:boolean;label?:string;stepKey?:string|number}){
  useEffect(()=>{if(typeof Taro.pageScrollTo==='function')void Taro.pageScrollTo({scrollTop:0,duration:0}).catch(()=>{});},[stepKey]);
  return <View className="gf-header"><Button className="gf-back" ariaLabel={label} disabled={disabled} onClick={back}><CIcon name="back"/><Text className="c-sr-only">{label}</Text></Button><CWordmark/></View>;
}
