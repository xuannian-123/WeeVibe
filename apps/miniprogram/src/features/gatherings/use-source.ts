import {useEffect,useRef} from 'react';
import {useDidHide,useDidShow,useUnload} from '@tarojs/taro';
import {getToken} from '../../platform/api';
export function useGatheringSource(session:string){
  const mounted=useRef(true),visible=useRef(true),epoch=useRef(0),ownerSession=useRef(session),currentSession=useRef(session);
  if(currentSession.current!==session){currentSession.current=session;epoch.current++;}
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;epoch.current++;};},[]);
  const hide=()=>{visible.current=false;epoch.current++;};useDidHide(hide);useUnload(hide);useDidShow(()=>{visible.current=true;});
  const valid=()=>mounted.current&&visible.current&&ownerSession.current===session&&currentSession.current===session&&getToken()===session;
  return {valid,alive:()=>mounted.current,ticket:()=>{const ticket=epoch.current;return()=>{if(!valid()||ticket!==epoch.current)throw Error('STALE_GATHERING');};}};
}
