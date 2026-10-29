import {useRef,useState} from 'react';
import {Button,Text,View} from '@tarojs/components';
import Taro from '@tarojs/taro';
import {gcj02Schema,type GatheringIntake,type Venue} from '@weevibe/contracts';
import {ApiClientError} from '@weevibe/api-client';
import {readPreciseLocation,requireLocationPermission,needsLocationSettings} from '../../platform/location-permission';
import {LocationSettings} from '../../components/location-settings';
import {searchForSession,locationError} from '../shell/location-api';
import {GatheringField} from './fields';
import {useGatheringSource} from './use-source';
import {gatheringMessage} from './client';
import {useMapPicker} from '../../platform/use-map-picker';
type Origin=GatheringIntake['private']['origin'];
export function GatheringOrigin({session,value,change,disabled=false}:{session:string;value:Origin;change:(v:Origin)=>void;disabled?:boolean}){
  const source=useGatheringSource(session),lock=useRef(false),blocked=useRef(disabled);blocked.current=disabled;const[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[denied,setDenied]=useState(false),[search,setSearch]=useState(false),[keyword,setKeyword]=useState(''),[places,setPlaces]=useState<Venue[]>([]);
  const[city,setCity]=useState(()=>{try{const v=Taro.getStorageSync('weevibe_selected_city');return typeof v==='string'?v:'';}catch{return '';}});
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
      change({label,...place.location});setSearch(false);setNotice('地图地点已填入私人出发地，仅本人可见。');
    }catch(e){if(source.valid()&&!(e instanceof ApiClientError&&e.code==='MAP_PICKER_STALE')){setDenied(needsLocationSettings(e));setNotice(e instanceof ApiClientError?e.message:'地图选点暂不可用，可继续手动填写。');}}
    finally{lock.current=false;if(source.alive())setBusy(false);}
  }
  async function locate(){if(disabled||lock.current||!source.valid())return;lock.current=true;setBusy(true);setNotice('');setDenied(false);const ticket=source.ticket();const guard=()=>{ticket();if(blocked.current)throw Error('STALE_GATHERING');};try{await requireLocationPermission(guard);guard();const p=await readPreciseLocation();guard();if(!Number.isFinite(p.latitude)||!Number.isFinite(p.longitude))throw Error('未能核对当前位置');const coordinates=gcj02Schema.safeParse({latitude:Number(p.latitude.toFixed(6)),longitude:Number(p.longitude.toFixed(6)),crs:'GCJ-02'});if(!coordinates.success)throw Error('未能核对当前位置');change({label:value?.label||'当前位置',...coordinates.data});setNotice('当前位置已填入私人栏位，可补充描述。');}catch(e){if(source.valid()&&!(e instanceof Error&&e.message==='STALE_GATHERING')){const reason=String((e as {errMsg?:unknown})?.errMsg||'');const denied=needsLocationSettings(e)||/auth deny|permission denied/i.test(reason);setDenied(denied);setNotice(/cancel/i.test(reason)?'已取消定位，可继续手动填写出发地点。':denied?'位置权限未开启，可打开设置或继续手动填写。':e instanceof ApiClientError?locationError(e):'未能获取当前位置，可重新定位或手动填写。');}}finally{lock.current=false;if(source.alive())setBusy(false);}}
  async function find(){if(disabled||lock.current||!city.trim()||!keyword.trim()||!source.valid())return;lock.current=true;setBusy(true);setNotice('');const ticket=source.ticket();const guard=()=>{ticket();if(blocked.current)throw Error('STALE_GATHERING');};try{const result=await searchForSession(session,{region:city.trim(),keyword:keyword.trim(),page_size:5},guard);guard();setPlaces(result.venues);if(!result.venues.length)setNotice('没有匹配地点，可手动填写。');}catch(e){if(source.valid()&&!(e instanceof Error&&e.message==='STALE_GATHERING'))setNotice(gatheringMessage(e));}finally{lock.current=false;if(source.alive())setBusy(false);}}
  if(!source.valid())return <Text className="gg-notice">登录来源已变化，私人出发地点已隐藏。</Text>;
  return <View><GatheringField label="从哪出发" privateField value={value?.label||''} disabled={busy||disabled} placeholder="手动填写出发地址" change={label=>{if(!disabled&&source.valid())change(label.trim()?{label}:null);}}/>
    <View className="gg-inline"><Button className="gg-soft" disabled={busy||disabled} onClick={()=>void selectMap()}>地图选择出发地</Button><Button className="gg-soft" disabled={busy||disabled} onClick={()=>void locate()}>获取定位</Button><Button className="gg-soft" disabled={busy||disabled} onClick={()=>setSearch(v=>!v)}>搜索地址</Button>{value&&(value.latitude!==undefined||value.longitude!==undefined)&&<Button className="gg-link" disabled={busy||disabled} onClick={()=>{if(!disabled&&source.valid())change(value?.label?{label:value.label}:null);}}>清除定位</Button>}</View>
    {search&&<View className="gg-panel"><GatheringField label="在哪个城市找" disabled={disabled||busy} value={city} change={setCity} placeholder="例如：杭州"/><GatheringField label="地址关键词" disabled={disabled||busy} value={keyword} change={setKeyword}/><Button className="gg-secondary" disabled={disabled||busy||!city.trim()||!keyword.trim()} onClick={()=>void find()}>搜索</Button>{places.map(p=><Button key={p.provider_id} disabled={disabled||busy} className="gg-search-result" onClick={()=>{if(!disabled&&source.valid()){change({label:[p.name,p.address].filter(Boolean).join(' ').slice(0,300),latitude:p.location.latitude,longitude:p.location.longitude,crs:'GCJ-02'});setSearch(false);}}}><Text>{p.name}</Text><Text className="gg-muted">{p.address}</Text></Button>)}</View>}
    {notice&&<Text className="gg-notice">{notice}</Text>}{denied&&<LocationSettings current={source.valid} changed={granted=>{setDenied(!granted);setNotice(granted?'位置权限已开启，请再次点击获取定位。':'可继续手动填写出发地点。');}}/>}
    <Text className="gg-muted">预算和个人出发地点始终仅本人可见，不进入共享内容和 AI 请求。</Text></View>;
}
