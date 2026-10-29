import {useContext,useEffect,useState} from 'react';
import Taro from '@tarojs/taro';
import {Button,Input,Text,View} from '@tarojs/components';
import './nickname-step.css';
import {GatheringDesignChrome} from './page-chrome';

type Props={value:string;mode:'form'|'interview';busy:boolean;saving:boolean;notice:string;change:(value:string)=>void;switchMode:(mode:'form'|'interview')=>void;adopt?:()=>void;next:()=>void;cancel:()=>void;single?:boolean;nextLabel?:string};

/** Presentation only: account reads, validation and draft ownership stay in the intake controller. */
export function GatheringNicknameStep({value,mode,busy,saving,notice,change,switchMode,adopt,next,cancel,single=false,nextLabel='下一步 →'}:Props){
  const[keyboard,setKeyboard]=useState(0);
  const chrome=useContext(GatheringDesignChrome);
  useEffect(()=>{chrome?.('nickname');return()=>chrome?.(null);},[chrome]);
  useEffect(()=>{
    const changed=(event:{height:number})=>setKeyboard(Math.max(0,event.height));
    Taro.onKeyboardHeightChange?.(changed);
    return()=>{Taro.offKeyboardHeightChange?.(changed);};
  },[]);
  const disabled=busy||saving,count=mode==='form'?5:6;
  return <View className={`gg-nickname${keyboard?' gg-nickname-keyboard':''}`}>
    <View className="gg-nickname-intro"><Text className="gg-nickname-eyebrow">填写我的想法</Text><Text className="gg-nickname-title">{single?'这次活动用什么昵称？':mode==='form'?'这次，怎么称呼你？':'这次活动用什么昵称？'}</Text></View>
    {!single&&<View className="gg-nickname-mode"><Button className={mode==='form'?'selected':''} disabled={disabled} onClick={()=>switchMode('form')}>填表</Button><Button className={mode==='interview'?'selected':''} disabled={disabled} onClick={()=>switchMode('interview')}>小橘头（AI问答）</Button></View>}
    {!single&&<View className="gg-nickname-progress"><Text>活动昵称 · 1 / {count}</Text><View>{Array.from({length:count},(_,i)=><View key={i} className={i===0?'current':''}/>)}</View></View>}
    <View className="gg-nickname-card"><View className="gg-field"><Text className="gg-label">本次活动昵称</Text><Input className="gg-nickname-input" value={value} maxlength={32} disabled={disabled} adjustPosition cursorSpacing={160} confirmType="next" placeholder="想在这次活动用什么昵称？" onInput={e=>change(e.detail.value)} onConfirm={()=>{if(!disabled)next();}}/></View>{adopt&&<Button className="gg-nickname-adopt" disabled={disabled} loading={busy} onClick={adopt}>使用小程序昵称</Button>}<Text className="gg-nickname-hint">此昵称仅用于本次活动。</Text></View>
    {notice&&<View className="gg-notice error">{notice}</View>}
    <View className="gg-nickname-footer" style={{bottom:`${keyboard}px`}}><Button className="gg-nickname-next" disabled={disabled} onClick={next}>{nextLabel}</Button><Button className="gg-nickname-cancel" disabled={disabled} onClick={cancel}>取消本次修改</Button></View>
  </View>;
}
