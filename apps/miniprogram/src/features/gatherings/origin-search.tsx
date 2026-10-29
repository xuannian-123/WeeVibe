import {useRef,useState} from 'react';
import {Button,Text,View} from '@tarojs/components';
import {gcj02Schema,type GatheringIntake} from '@weevibe/contracts';
import {ApiClientError} from '@weevibe/api-client';
import {needsLocationSettings} from '../../platform/location-permission';
import {LocationSettings} from '../../components/location-settings';
import {GatheringField} from './fields';
import {useGatheringSource} from './use-source';
import {useMapPicker} from '../../platform/use-map-picker';
type Origin=GatheringIntake['private']['origin'];
export function GatheringOrigin({session,value,change,disabled=false}:{session:string;value:Origin;change:(v:Origin)=>void;disabled?:boolean}){
  const source=useGatheringSource(session),lock=useRef(false),blocked=useRef(disabled);blocked.current=disabled;const[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[denied,setDenied]=useState(false);
  const choose=useMapPicker(disabled,session);
  async function selectMap(){
    if(disabled||lock.current||!source.valid())return;
    lock.current=true;setBusy(true);setNotice('');setDenied(false);
    try{
      const current=value?.latitude!==undefined&&value.longitude!==undefined?gcj02Schema.safeParse({latitude:value.latitude,longitude:value.longitude,crs:'GCJ-02'}):undefined;
      const place=await choose(current?.success?current.data:undefined);
      if(!place||blocked.current||!source.valid())return;
      const label=[place.name,place.address].filter(Boolean).join(' ');
      if(label.length>300){setNotice('所选地点名称与地址过长，请选择更简短的地点或手动填写；原出发地已保留。');return;}
      change({label,...place.location});setNotice('地图地点已填入私人出发地，仅本人可见。');
    }catch(e){if(source.valid()&&!(e instanceof ApiClientError&&e.code==='MAP_PICKER_STALE')){setDenied(needsLocationSettings(e));setNotice(e instanceof ApiClientError?e.message:'地图选点暂不可用，可继续手动填写。');}}
    finally{lock.current=false;if(source.alive())setBusy(false);}
  }
  if(!source.valid())return <Text className="gg-notice">登录来源已变化，私人出发地点已隐藏。</Text>;
  return <View><GatheringField label="从哪出发" privateField value={value?.label||''} disabled={busy||disabled} placeholder="手动填写出发地址" change={label=>{if(!disabled&&source.valid())change(label.trim()?{label}:null);}}/>
    <View className="gg-inline"><Button className="gg-soft" disabled={busy||disabled} onClick={()=>void selectMap()}>地图选择出发地</Button>{value&&(value.latitude!==undefined||value.longitude!==undefined)&&<Button className="gg-link" disabled={busy||disabled} onClick={()=>{if(!disabled&&source.valid())change(value?.label?{label:value.label}:null);}}>清除定位</Button>}</View>
    {notice&&<Text className="gg-notice">{notice}</Text>}{denied&&<LocationSettings current={source.valid} changed={granted=>{setDenied(!granted);setNotice(granted?'位置权限已开启，请再次点击地图选择出发地。':'可继续手动填写出发地点。');}}/>}
    <Text className="gg-muted">预算和个人出发地点始终仅本人可见，不进入共享内容和 AI 请求。</Text></View>;
}
