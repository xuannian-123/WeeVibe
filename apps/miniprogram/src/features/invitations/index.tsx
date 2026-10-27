import { useEffect, useRef, useState } from 'react';
import Taro, { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { ApiClientError } from '@weevibe/api-client';
import { getToken } from '../../platform/api';
import { Button, Text, View } from '@tarojs/components';
import type { ActivityDetail } from '@weevibe/contracts';
import type { InvitationSourceView } from '@weevibe/contracts/src/invitations';
import { Action, Notice, Panel } from '../../components/ui';
import { errorText } from '../../platform/page-state';
import { createInvitationSource, readInvitationSource, saveInvitationSource } from './api';

// The activity controller owns the single share handler; source IDs are public provenance, not access credentials.
function mayCreate(detail: ActivityDetail) {
 return !detail.cancelled_at && !!detail.viewer.user_id && (detail.viewer.is_manager || detail.viewer.participations.some(p => p.status !== 'exited' && detail.segments.some(s => s.segment_id === p.segment_id && !s.cancelled_at && Date.parse(s.ends_at) > Date.parse(detail.server_time))));
}
const snapshotKey = (detail: ActivityDetail) => JSON.stringify([detail.activity_id, detail.revision, detail.cancelled_at, detail.viewer.user_id, detail.viewer.is_manager, detail.viewer.participations, detail.segments]);
export function InvitationPanel({ id, detail, session, fresh, incomingId, outgoingId, onSourceCreated, anyBusy, onBusyChange }: { id: string; detail: ActivityDetail; session: string | undefined; fresh: boolean; incomingId?: string; outgoingId?: string; onSourceCreated:(id:string)=>void; anyBusy:boolean; onBusyChange?:(busy:boolean)=>void }) {
 const [source,setSource]=useState<InvitationSourceView>();const[loading,setLoading]=useState(false);const[busy,setBusy]=useState(false);const[message,setMessage]=useState('');const[saved,setSaved]=useState(false);const locked=useRef(false);
 const actor=detail.viewer.user_id;const canCreate=mayCreate(detail);
 const mounted=useRef(true), visible=useRef(true), epoch=useRef(0);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;epoch.current++;};},[]);
 const deactivate=()=>{visible.current=false;epoch.current++;};useDidHide(deactivate);useUnload(deactivate);useDidShow(()=>{visible.current=true;});
 const active=()=>mounted.current&&visible.current;
 const latest=useRef({id,detail,session,fresh,incomingId,source});latest.current={id,detail,session,fresh,incomingId,source};
 function guard(action:'create'|'save') {
   const ticket=epoch.current;const before=snapshotKey(detail);const sourceId=source?.invitation_id;
   return ()=>{
     const current=latest.current;
     if(!active()||ticket!==epoch.current||!session||getToken()!==session||current.session!==session||!current.fresh||current.id!==id||snapshotKey(current.detail)!==before||current.incomingId!==incomingId||
       (action==='create'?!mayCreate(current.detail):!sourceId||current.source?.invitation_id!==sourceId||current.source.activity_id!==id))
       throw new ApiClientError('INVALID_RESPONSE','页面或邀请状态已变化，操作结果未确认，请返回原活动核对。',0);
   };
 }
 useEffect(()=>{let live=true;setSource(undefined);setSaved(false);setMessage('');if(incomingId){setLoading(true);void readInvitationSource(incomingId).then(value=>{if(live){if(value.activity_id===id)setSource(value);else setMessage('该邀请入口不属于当前活动。');}}).catch(e=>{if(live)setMessage(errorText(e));}).finally(()=>{if(live)setLoading(false);});}else setLoading(false);return()=>{live=false;};},[id,incomingId,actor]);
 useEffect(()=>{onBusyChange?.(busy);return()=>onBusyChange?.(false);},[busy,onBusyChange]);
 async function create(){
   if(!actor||!canCreate||!fresh||anyBusy||locked.current||!active())return;
   const assertCurrent=guard('create');locked.current=true;setBusy(true);setMessage('');let requested=false;
   try{
     assertCurrent();
     const choice=await Taro.showModal({title:'创建可转发邀请入口',content:'将公开你的小程序昵称作为邀请来源，不公开个人资料和答卷。入口可被转发，不验证指定收件人或微信群成员，也不授予席位。'});
     if(!choice.confirm)return;assertCurrent();requested=true;
     const value=await createInvitationSource(id,actor,session,assertCurrent);assertCurrent();
     onSourceCreated(value.invitation_id);setMessage('邀请入口已准备好，请点击分享按钮。尚未替你发送给任何人。');
   }catch(e){if(active())setMessage(requested?errorText(e):'确认未完成或页面状态已变化，本次未发送；请重新核对后再试。');}
   finally{locked.current=false;if(mounted.current)setBusy(false);}
 }
 async function save(){
   if(!actor||!source||!fresh||anyBusy||locked.current||!active())return;
   const assertCurrent=guard('save');locked.current=true;setBusy(true);setMessage('');
   try{assertCurrent();await saveInvitationSource(source.invitation_id,id,actor,session,assertCurrent);assertCurrent();setSaved(true);setMessage('已保存这份可转发入口，可在 GO 的已保存邀请中找回；这不代表报名成功。');}
   catch(e){if(active())setMessage(errorText(e));}finally{locked.current=false;if(mounted.current)setBusy(false);}
 }
 return <Panel title="约朋友一起">
   {incomingId&&<View>{loading&&<Notice>正在核验邀请来源…</Notice>}{source&&<View><Text>来自 {source.inviter_display_name||'一位活动成员'} 的可转发邀请入口</Text><Text className="caption">它只说明真实邀请来源，不验证你是指定收件人或当前群成员。</Text><Action disabled={anyBusy||busy||!fresh||!actor||saved} onClick={()=>{void save();}}>{saved?'已保存这份邀请':actor?'保存这份邀请到 GO':'登录后可保存邀请'}</Action></View>}</View>}
   <Text className="activity-muted">分享这份行程，让朋友本人选择想参加的环节。</Text>
   {canCreate&&<Action disabled={anyBusy||busy||!fresh} onClick={()=>{void create();}}>{outgoingId?'重新使用我的邀请入口':'准备带来源的邀请入口'}</Action>}
   <Button className="activity-share" openType="share" disabled={anyBusy}>{outgoingId?'分享我的邀请入口':'分享公开行程'}</Button>
   <Action variant="text" disabled={anyBusy} onClick={()=>{void Taro.setClipboardData({data:id}).catch(()=>{void Taro.showToast({title:'复制未完成，请重试',icon:'none'});});}}>复制活动编号</Action>
   <Text className="caption">普通活动编号不自动记为收到邀请。分享不会赋予管理权限、答卷权限、群资格或席位；登录及原报名审批规则保持不变。</Text>
   {message&&<Notice>{message}</Notice>}
 </Panel>;
}
