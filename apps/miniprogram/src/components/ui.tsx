import { Button, Input, Text, View } from '@tarojs/components';
import type { PropsWithChildren } from 'react';

export function Panel({ title, children, className = '' }: PropsWithChildren<{ title: string; className?: string }>) {
  return <View className={`panel ${className}`}><View className="heading"><Text>{title}</Text></View>{children}</View>;
}
export function Notice({ children, tone = 'info' }: PropsWithChildren<{ tone?: 'info' | 'error' | 'success' }>) { return <View className={`notice notice-${tone}`}><Text>{children}</Text></View>; }
export function Field({ label, value, onChange, placeholder = '', disabled = false, numeric = false, hint }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string; disabled?: boolean; numeric?: boolean; hint?: string;
}) {
  return <View className="field"><Text className="field-label">{label}</Text><Input ariaLabel={label} type={numeric ? 'digit' : 'text'} value={value}
    disabled={disabled} placeholder={placeholder} placeholderClass="input-placeholder" maxlength={1000} onInput={e => onChange(e.detail.value)} />
    {hint && <Text className="caption field-hint">{hint}</Text>}</View>;
}
export function Action({ children, onClick, disabled = false, variant = 'secondary' }: PropsWithChildren<{ onClick: () => void; disabled?: boolean; variant?: 'primary' | 'secondary' | 'text' | 'danger' }>) {
  return <Button className={`action action-${variant}`} disabled={disabled} onClick={onClick}>{children}</Button>;
}
