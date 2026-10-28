import {useEffect,useRef,useState} from 'react';
import Taro from '@tarojs/taro';
import {Button,Text,View} from '@tarojs/components';
import {gatheringSubscriptionConfigSchema,gatheringSubscriptionIntentSchema,gatheringSubscriptionIntentResultSchema} from '@weevibe/contracts';
import {newKey} from '../../platform/local-id';
import {useStoredWrite} from '../../platform/write-state';
import {gatheringRequest} from './client';
import {useGatheringSource} from './use-source';

type Config=ReturnType<typeof gatheringSubscriptionConfigSchema.parse>;
type Intent=Omit<ReturnType<typeof gatheringSubscriptionIntentSchema.parse>,'gathering_id'>;
// Installed Taro's shared option type requires Alipay-only entityIds as well.
// This adapter describes only the documented WeChat template-ID interface.
type WechatSubscribe=(options:Pick<Taro.requestSubscribeMessage.BaseOption,'tmplIds'|'success'|'fail'>)=>ReturnType<typeof Taro.requestSubscribeMessage>;
const path='/api/v1/gatherings/notifications/subscription';

export function useGatheringSubscription(actor:string,session:string){
  const source=useGatheringSource(session),lock=useRef(false);
  const[config,setConfig]=useState<Config>(),[authorizing,setAuthorizing]=useState(false),[notice,setNotice]=useState('');
  async function load(){
    if(!source.valid())return;const guard=source.ticket();
    try{const next=await gatheringRequest(session,path,'GET',undefined,v=>gatheringSubscriptionConfigSchema.parse(v),guard);guard();setConfig(next);}
    catch{if(source.valid())setNotice('微信提醒设置暂时无法读取，提交和站内提醒仍可使用。');}
  }
  useEffect(()=>{void load();},[actor,session]);
  const write=useStoredWrite({storageKey:`weevibe-gathering-subscription-pending-v1:${actor}`,userId:actor,parse:v=>gatheringSubscriptionIntentSchema.parse(v),
    execute:input=>gatheringRequest(session,path,'POST',input,v=>gatheringSubscriptionIntentResultSchema.parse(v),source.ticket()),
    committed:()=>{if(!source.valid())throw Error('STALE_GATHERING');},
  });
  // Called synchronously from a real button handler, using already loaded config.
  // No configuration fetch, modal or server request precedes the native API call.
  async function requestFromTap():Promise<Intent|undefined>{
    if(lock.current||write.pending||write.busy||!source.valid())return;
    if(!config?.enabled||!config.template_id||typeof Taro.requestSubscribeMessage!=='function'){
      setNotice('微信提醒暂未开启；成员更新仍会保存在小程序消息中。');return;
    }
    lock.current=true;setAuthorizing(true);setNotice('');const guard=source.ticket(),template=config.template_id;
    try{
      const result=await new Promise<string>((resolve,reject)=>{
        try{const pending=(Taro.requestSubscribeMessage as unknown as WechatSubscribe)({tmplIds:[template],success:value=>resolve(String(value[template]??'')),fail:()=>reject(Error('SUBSCRIPTION_UNAVAILABLE'))});
          if(pending&&typeof pending.catch==='function')void pending.catch(()=>reject(Error('SUBSCRIPTION_UNAVAILABLE')));
        }catch{reject(Error('SUBSCRIPTION_UNAVAILABLE'));}
      });
      guard();
      if(result!=='accept'&&result!=='reject'&&result!=='ban'){setNotice('微信提醒未开启，站内提醒仍可查看。');return;}
      if(result!=='accept')setNotice('你未开启微信提醒；站内更新仍会保留。');
      return {authorization_key:newKey(),template_id:template,result};
    }catch{if(source.valid())setNotice('微信提醒授权未完成，提交和站内提醒仍可继续。');return;}
    finally{lock.current=false;if(source.alive())setAuthorizing(false);}
  }
  async function record(gatheringId:string,intent:Intent){if(source.valid())await write.send({...intent,gathering_id:gatheringId});}
  return {config,authorizing,busy:authorizing||write.busy,pending:write.pending,notice:write.message||notice,requestFromTap,record,retry:()=>write.send(),reload:load};
}

export function GatheringSubscription({value,gatheringId}:{value:ReturnType<typeof useGatheringSubscription>;gatheringId:string}){
  return <View className="gg-panel"><Text className="gg-heading">活动更新提醒</Text><Text className="gg-muted">站内消息保留每次更新。微信服务通知需要你同意订阅，每次同意可接收一条本次活动的后续提醒。</Text>
    {value.notice&&<Text className="gg-notice">{value.notice}</Text>}
    {value.pending?<Button className="gg-secondary" loading={value.busy} disabled={value.busy} onClick={()=>void value.retry()}>核对上次微信提醒授权</Button>:value.config?.enabled?<Button className="gg-secondary" loading={value.busy} disabled={value.busy} onClick={()=>{void value.requestFromTap().then(intent=>intent?value.record(gatheringId,intent):undefined);}}>开启微信提醒</Button>:<Button className="gg-link" onClick={()=>void value.reload()}>读取微信提醒设置</Button>}
  </View>;
}
