import {Text,View} from '@tarojs/components';
import {CAction} from '../design-c/ui';
import {GatheringFlowHeader} from './flow-header';
import './preference-form.css';

export function GatheringEntryState({mode,message,busy,home,retry}:{mode:'loading'|'login'|'error'|'invalid';message:string;busy:boolean;home:()=>void;retry:()=>void}){
  const title=mode==='loading'?'正在打开这次相聚':mode==='login'?'先用微信身份继续':mode==='invalid'?'这个入口不完整':'暂时没能打开活动';
  return <View className="c-ui gf-start ge-state"><GatheringFlowHeader back={home} disabled={busy} label="回到首页"/><View className="gf-heading"><Text className="gf-eyebrow">WEEVIBE / 一起出发</Text><Text className="gf-title">{title}</Text><View className="gf-marker"/></View><View className="gp-panel"><Text className="gp-caption">{message||(mode==='loading'?'正在核对微信身份和活动信息，请稍等。':mode==='login'?'请先使用微信身份继续。':'请核对分享入口，或重新读取活动。')}</Text></View>{mode==='login'&&<Text className="gp-caption">登录后继续当前分享入口，无需设置账号头像或昵称。</Text>}{mode!=='invalid'&&<CAction className="ge-action" variant="primary" disabled={busy} loading={busy} onClick={retry}>{busy?'正在读取…':mode==='login'?'微信登录并继续':'重新读取活动'}</CAction>}</View>;
}
