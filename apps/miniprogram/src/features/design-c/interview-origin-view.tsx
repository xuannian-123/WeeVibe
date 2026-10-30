import {Input,Text,View} from '@tarojs/components';
import type {GatheringIntake} from '@weevibe/contracts';
import {CAction,CNotice} from './ui';
import {CLocationSettings} from './ui';
type Props={value:GatheringIntake['private']['origin'];disabled:boolean;busy:boolean;notice:string;denied:boolean;current:()=>boolean;change:(v:string)=>void;selectMap:()=>void;clearCoordinates:()=>void;permissionChanged:(v:boolean)=>void};
export function COriginView(p:Props){const blocked=p.disabled||p.busy;return <View className="ci-inputs c-ui"><Text className="ci-field-label">从哪出发 · 仅本人</Text><Input className="ci-control" value={p.value?.label||''} maxlength={300} disabled={blocked} adjustPosition cursorSpacing={24} placeholder="手动填写出发地址" onInput={e=>p.change(e.detail.value)}/><View className="ci-origin-actions"><CAction disabled={blocked} onClick={p.selectMap}>地图选择出发地</CAction>{p.value?.latitude!==undefined&&<CAction variant="text" disabled={blocked} onClick={p.clearCoordinates}>清除定位</CAction>}</View>{p.notice&&<CNotice>{p.notice}</CNotice>}{p.denied&&<CLocationSettings current={p.current} changed={p.permissionChanged}/>}<Text className="ci-input-hint">出发地仅本人可见，不进入共享内容或AI请求。</Text></View>;}
