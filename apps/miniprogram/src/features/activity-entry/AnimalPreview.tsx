import { useEffect, useRef, useState } from 'react';
import { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { Button, Image, Text, View } from '@tarojs/components';
import type { GatheringAnimalId } from '@weevibe/contracts';
import { Action } from '../../components/ui';
import { getToken } from '../../platform/api';
import { invitationAnimals, randomInvitationAnimal } from './animal-options';

/** Deliberately ephemeral. Formal activity APIs do not accept an animal_id yet. */
export function AnimalPreview({ session, disabled }: { session?: string; disabled: boolean }) {
  const [selected, setSelected] = useState<GatheringAnimalId>();
  const visible = useRef(true), mounted = useRef(true), generation = useRef(0);
  const latest = useRef({ session, disabled }); latest.current = { session, disabled };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  const clear = () => { visible.current = false; generation.current++; setSelected(undefined); };
  useDidHide(clear); useUnload(clear); useDidShow(() => { visible.current = true; });
  const ticket = generation.current;
  function choose(value?: GatheringAnimalId) {
    if (!mounted.current || !visible.current || generation.current !== ticket || latest.current.disabled || latest.current.session !== session || !session || getToken() !== session) return;
    setSelected(value);
  }
  return <View className="iv-animal-preview">
    <View className="iv-heading-row"><Text className="iv-label">挑一个动物形象</Text><Text className="iv-preview-tag">仅预览 · 尚未保存</Text></View>
    <Text className="iv-muted">试试本次活动的形象。当前报名接口尚不支持保存动物，离开页面会清除选择；不会修改账号头像。</Text>
    <View className="iv-animal-grid">{invitationAnimals.map(animal => <Button key={animal.id} className={`iv-animal ${selected === animal.id ? 'iv-animal-selected' : ''}`} ariaLabel={`预览${animal.name}${selected === animal.id ? '，已选择，尚未保存' : ''}`} disabled={disabled} onClick={() => choose(animal.id)}>
      <Image className="iv-animal-image" src={animal.image} mode="aspectFit"/><Text>{animal.name}{selected === animal.id ? ' ✓' : ''}</Text>
    </Button>)}</View>
    <View className="iv-animal-actions"><Action disabled={disabled} onClick={() => choose(randomInvitationAnimal(selected))}>随机换一个</Action><Action variant="text" disabled={disabled || !selected} onClick={() => choose(undefined)}>清除预览</Action></View>
    {selected && <Text className="iv-animal-result">已预览{invitationAnimals.find(animal => animal.id === selected)!.name} · 尚未保存，不随报名提交</Text>}
  </View>;
}
