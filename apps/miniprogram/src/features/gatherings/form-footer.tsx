import type {ReactNode} from 'react';
import {View} from '@tarojs/components';
import {useGatheringFormKeyboard} from './use-form-keyboard';
export function GatheringFormFooter({children,className='gg-form-footer'}:{children:ReactNode;className?:string}){
  const {bottom}=useGatheringFormKeyboard();
  return <View className={className} style={{bottom:`${bottom}px`}}>{children}</View>;
}
