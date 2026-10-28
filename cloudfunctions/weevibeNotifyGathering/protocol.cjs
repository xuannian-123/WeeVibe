'use strict';
const {createHash,createHmac,randomBytes,timingSafeEqual}=require('node:crypto');
const PURPOSE='gathering-submission-notify',PREFIX='/api/internal/gathering-notifications/';
class NotificationProofError extends Error{constructor(kind){super(kind==='configuration'?'Notification worker is not configured':'Invalid notification worker proof');this.kind=kind;}}
function readConfig(env){
  const scope=env.GATHERING_NOTIFY_ENV,appId=env.GATHERING_NOTIFY_APPID,secret=env.GATHERING_NOTIFY_WORKER_SECRET;
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,99}$/.test(scope||'')||!/^wx[0-9a-f]{16}$/i.test(appId||'')||! /^[A-Za-z0-9_-]{43,128}$/.test(secret||''))throw new NotificationProofError('configuration');
  return {scope,appId,secret};
}
const digest=body=>createHash('sha256').update(body).digest('hex');
function signature(path,body,config){if(!['claim','ack'].some(action=>path===PREFIX+action))throw new NotificationProofError('identity');return createHmac('sha256',config.secret).update(`WEEVIBE_NOTIFY_V1\nPOST\n${path}\n${digest(body)}`).digest('hex');}
function sign(action,payload,config,now=Date.now(),nonce=randomBytes(24).toString('base64url')){
  const path=PREFIX+action,body=JSON.stringify({version:1,scope:config.scope,app_id:config.appId,purpose:PURPOSE,timestamp:Math.floor(now/1000),nonce,payload});return {path,body,signature:signature(path,body,config)};
}
function verify(path,body,supplied,config,now=Date.now()){
  if(typeof body!=='string'||Buffer.byteLength(body)>16384||!/^[a-f0-9]{64}$/.test(supplied||''))throw new NotificationProofError('identity');
  const expected=signature(path,body,config);if(!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(supplied,'hex')))throw new NotificationProofError('identity');
  let value;try{value=JSON.parse(body);}catch{throw new NotificationProofError('identity');}
  if(!value||Object.keys(value).sort().join(',')!=='app_id,nonce,payload,purpose,scope,timestamp,version'||value.version!==1||value.scope!==config.scope||value.app_id!==config.appId||value.purpose!==PURPOSE||!Number.isSafeInteger(value.timestamp)||Math.abs(now/1000-value.timestamp)>60||!/^[A-Za-z0-9_-]{32}$/.test(value.nonce||''))throw new NotificationProofError('identity');
  return {payload:value.payload,nonceHash:digest(value.nonce),expiresAt:new Date((value.timestamp+61)*1000)};
}
module.exports={PURPOSE,PREFIX,NotificationProofError,readConfig,sign,verify};
