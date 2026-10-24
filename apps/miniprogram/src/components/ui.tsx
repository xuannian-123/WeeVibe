import { Button, Input, Text, View } from '@tarojs/components';
import type { PropsWithChildren } from 'react';

export function Panel({ title, children }: PropsWithChildren<{ title: string }>) {
  return <View className="panel"><View className="heading"><Text>{title}</Text></View>{children}</View>;
}
export function Notice({ children }: PropsWithChildren) { return <View className="notice"><Text>{children}</Text></View>; }
export function Field({ label, value, onChange, placeholder = '', disabled = false, numeric = false }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string; disabled?: boolean; numeric?: boolean;
}) {
  return <View className="field"><Text>{label}</Text><Input ariaLabel={label} type={numeric ? 'digit' : 'text'} value={value}
    disabled={disabled} placeholder={placeholder} maxlength={1000} onInput={e => onChange(e.detail.value)} /></View>;
}
export function Action({ children, onClick, disabled = false }: PropsWithChildren<{ onClick: () => void; disabled?: boolean }>) {
  return <Button className="action" disabled={disabled} onClick={onClick}>{children}</Button>;
}
