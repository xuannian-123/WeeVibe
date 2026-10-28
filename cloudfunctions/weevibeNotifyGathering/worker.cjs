'use strict';
const {readConfig,sign}=require('./protocol.cjs');
const TRIGGER='gatheringSubmissionNotify';
function settings(env){
  const config=readConfig(env),origin=new URL(env.GATHERING_NOTIFY_API_ORIGIN||'');
  if(env.GATHERING_NOTIFY_ENABLED!=='true'||origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error('configuration');
  const templateId=env.GATHERING_NOTIFY_TEMPLATE_ID||'',state=env.GATHERING_NOTIFY_MINIPROGRAM_STATE||'formal',limit=Number(env.GATHERING_NOTIFY_BATCH_SIZE||5);
  let fields;try{fields=JSON.parse(env.GATHERING_NOTIFY_TEMPLATE_FIELDS||'');}catch{throw Error('configuration');}
  const types={event:'thing',service:'thing',hint:'thing',time:'time',actor:'name',status:'phrase'};
  if(!/^[A-Za-z0-9_-]{10,200}$/.test(templateId)||!['formal','trial','developer'].includes(state)||!Number.isInteger(limit)||limit<1||limit>10||!fields||Array.isArray(fields)||Object.keys(fields).length<1||Object.keys(fields).length>5||Object.entries(fields).some(([key,source])=>!types[source]||!new RegExp(`^${types[source]}[0-9]{1,2}$`).test(key)))throw Error('configuration');
  return {...config,origin:origin.origin,templateId,state,limit,fields};
}
async function jsonResponse(response){
  if(!response.ok)throw Error('api');const reader=response.body?.getReader();if(!reader)throw Error('api');const chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>32768)throw Error('api');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function createWorker({env,context,send,fetchImpl=globalThis.fetch,now=()=>Date.now(),sendTimeoutMs=8000}){
  return async event=>{
    let config;try{config=settings(env);}catch{return {ok:false,code:'NOT_CONFIGURED'};}
    const wx=context(),observed=wx.ENV||env.TCB_ENV||env.SCF_NAMESPACE;
    if(wx.OPENID||wx.FROM_OPENID||wx.APPID&&wx.APPID!==config.appId||wx.FROM_APPID&&wx.FROM_APPID!==config.appId||observed!==config.scope||event?.Type!=='Timer'||event.TriggerName!==TRIGGER)return {ok:false,code:'FORBIDDEN'};
    const request=async(action,payload)=>{const proof=sign(action,payload,config,now());return jsonResponse(await fetchImpl(config.origin+proof.path,{method:'POST',headers:{'Content-Type':'application/json','x-weevibe-notify-signature':proof.signature},body:proof.body,redirect:'error',signal:AbortSignal.timeout(5000)}));};
    let batch;try{batch=await request('claim',{limit:config.limit});}catch{return {ok:false,code:'QUEUE_UNAVAILABLE'};}
    if(!batch||!Array.isArray(batch.jobs)||batch.jobs.length>config.limit)return {ok:false,code:'INVALID_QUEUE_RESPONSE'};
    const counts={ok:true,claimed:batch.jobs.length,sent:0,failed:0,unknown:0,ack_failed:0};
    await Promise.all(batch.jobs.map(async job=>{
      const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if(!job||!uuid.test(job.outbox_id)||!/^[A-Za-z0-9_-]{43}$/.test(job.lease_token||'')){counts.ack_failed++;return;}
      let outcome='unknown',code=null;
      if(job.template_id!==config.templateId||!uuid.test(job.gathering_id)||!['submitted','updated'].includes(job.event_kind)||!/^[A-Za-z0-9_-]{1,128}$/.test(job.touser||'')){outcome='failed';code=47003;}
      else if(!Number.isFinite(Date.parse(job.lease_expires_at))||Date.parse(job.lease_expires_at)<=now()+sendTimeoutMs+5000||!Number.isFinite(Date.parse(job.created_at))){outcome='unknown';}
      else{
        const date=new Date(Date.parse(job.created_at)+8*3600000).toISOString().slice(0,16).replace('T',' ');
        const values={event:job.event_kind==='submitted'?'有成员已提交填写':'有成员更新了填写',service:'WeeVibe活动筹备',hint:'点击查看最新填写',time:date,actor:'活动成员',status:'填写更新'};
        const data=Object.fromEntries(Object.entries(config.fields).map(([key,source])=>[key,{value:values[source]}]));
        let timer;
        try{
          const result=await Promise.race([Promise.resolve().then(()=>send({touser:job.touser,templateId:config.templateId,page:`pages/gathering/index?id=${job.gathering_id}&entry=share`,data,miniprogramState:config.state,lang:'zh_CN'})),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('unknown')),sendTimeoutMs);})]);
          code=Number.isInteger(result?.errCode)?result.errCode:null;
          outcome=code===0?'sent':[40003,40037,43101,47003,41030,45009].includes(code)?'failed':'unknown';
        }catch(error){code=Number.isInteger(error?.errCode)?error.errCode:null;outcome=[40003,40037,43101,47003,41030,45009].includes(code)?'failed':'unknown';}finally{clearTimeout(timer);}
      }
      counts[outcome]++;
      // A receipt retry does not invoke WeChat again. A lost receipt eventually becomes unknown.
      let acknowledged=false;
      for(let retry=0;retry<2&&!acknowledged;retry++){try{const receipt=await request('ack',{outbox_id:job.outbox_id,lease_token:job.lease_token,outcome,err_code:code});acknowledged=receipt?.recorded===true;}catch{}}
      if(!acknowledged)counts.ack_failed++;
    }));
    return counts;
  };
}
module.exports={createWorker,settings,TRIGGER};
