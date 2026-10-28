'use strict';
const {createWorker}=require('./worker.cjs');
const {readConfig}=require('./protocol.cjs');
const {parseContext}=require('@cloudbase/node-sdk');
function invocationIdentity(context,config){
  const parsed=parseContext(context),current=parsed.environment??parsed.environ;
  // getWXContext reads process-global WX_* variables and may retain a prior caller.
  // Only this invocation's platform context can establish its environment/source.
  if(parsed.namespace!==config.scope||!current||typeof current!=='object'||Array.isArray(current)||
    current.TCB_ENV!==undefined&&current.TCB_ENV!==config.scope||current.SCF_NAMESPACE!==undefined&&current.SCF_NAMESPACE!==config.scope||
    current.WX_OPENID||current.WX_FROM_OPENID||current.WX_APPID!==undefined&&current.WX_APPID!==config.appId||
    current.WX_FROM_APPID!==undefined&&current.WX_FROM_APPID!==config.appId||
    current.TCB_SOURCE!==undefined&&(typeof current.TCB_SOURCE!=='string'||current.TCB_SOURCE.startsWith('wx_')))throw Error('forbidden');
  return {ENV:parsed.namespace,APPID:current.WX_APPID,FROM_APPID:current.WX_FROM_APPID};
}
function createNotificationHandler({env=process.env,fetchImpl,send,loadCloud=()=>require('wx-server-sdk')}={}){
  let cloud;
  const deliver=send||(input=>{if(!cloud){cloud=loadCloud();cloud.init({env:cloud.DYNAMIC_CURRENT_ENV});}return cloud.openapi.subscribeMessage.send(input);});
  return async(event,context)=>{
    let config;try{config=readConfig(env);}catch{return {ok:false,code:'NOT_CONFIGURED'};}
    let identity;try{identity=invocationIdentity(context,config);}catch{return {ok:false,code:'FORBIDDEN'};}
    return createWorker({env,context:()=>identity,send:deliver,...(fetchImpl?{fetchImpl}:{})})(event);
  };
}
exports.createNotificationHandler=createNotificationHandler;
exports.main=createNotificationHandler();
