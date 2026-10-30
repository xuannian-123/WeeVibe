import { Input, Text, View } from '@tarojs/components';
import type { PropsWithChildren } from 'react';
export { CAction as Action } from '../design-c/ui';
import './activity-ui.css';

export function Panel({title, children, className = ''}: PropsWithChildren<{title:string;className?:string}>) {
  return <View className={`ca-panel c-ui ${className}`}><Text className="ca-heading">{title}</Text>{children}</View>;
}
export function Notice({children,tone='info'}:PropsWithChildren<{tone?:'info'|'error'|'success'}>) {
  return <View className={`ca-notice ca-notice-${tone}`}><Text>{children}</Text></View>;
}
export function Field({label,value,onChange,placeholder='',disabled=false,numeric=false,hint}:{label:string;value:string;onChange:(value:string)=>void;placeholder?:string;disabled?:boolean;numeric?:boolean;hint?:string}) {
  return <View className="ca-field"><Text className="ca-field-label">{label}</Text><Input ariaLabel={label} type={numeric?'digit':'text'} value={value} disabled={disabled} placeholder={placeholder} placeholderClass="ca-placeholder" maxlength={1000} onInput={event=>onChange(event.detail.value)}/>{hint&&<Text className="ca-field-hint">{hint}</Text>}</View>;
}
