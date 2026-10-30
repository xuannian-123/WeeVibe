import { useEffect, useRef, useState, type PropsWithChildren, type ReactNode } from 'react';
import Taro from '@tarojs/taro';
import { Button, ScrollView, Text, View, type ButtonProps } from '@tarojs/components';
import { CIcon } from './chrome';
import { LOCATION_SCOPE } from '../../platform/location-permission';
import './screens.css';

export function CAction({ variant = 'secondary', className = '', children, ...props }: PropsWithChildren<ButtonProps & { variant?: 'primary' | 'secondary' | 'text' | 'danger' }>) {
  return <Button {...props} className={`c-action c-action-${variant} ${className}`}>{children}</Button>;
}
export function CNotice({ children }: PropsWithChildren) { return <View className="c-notice">{children}</View>; }
export function CPageHeading({ title, children }: PropsWithChildren<{ title: string }>) { return <View className="c-page-heading"><Text>{title}</Text><View>{children}</View></View>; }
export function CHero({ kind }: { kind: 'ideas' | 'messages' }) {
  return <View className={`c-screen-hero c-screen-hero-${kind}`}><Text>{kind === 'ideas' ? 'Find your' : "You're"}</Text><Text className="c-marker">{kind === 'ideas' ? 'next good time.' : 'in the loop.'}</Text>{kind === 'messages' && <Text className="c-heart-doodle">♡</Text>}</View>;
}
export function CLocationSettings({ current, changed }: { current: () => boolean; changed: (granted: boolean) => void }) {
  return <View className="c-permission"><Text>可在微信设置中允许精确位置，也可按城市浏览。</Text><CAction openType="openSetting" onOpenSetting={event => { if (current()) changed(event.detail.authSetting[LOCATION_SCOPE] === true); }}>打开位置权限设置</CAction></View>;
}

let sheetCount = 0;
/** The header/footer never enter the sole scrolling region. Keyboard listeners are local. */
export function CSheet({ title, close, children, footer, extra, className = '', tall = false }: PropsWithChildren<{ title: string; close: () => void; footer?: ReactNode; extra?: ReactNode; className?: string; tall?: boolean }>) {
  const [id] = useState(() => `c-sheet-${++sheetCount}`);
  const baseHeight = useRef(typeof Taro.getWindowInfo === 'function' ? Taro.getWindowInfo().windowHeight : 700);
  const keyboard = useRef(0);
  const [layout, setLayout] = useState({ bottom: 0, height: Math.round(baseHeight.current * (tall ? .65 : .42)) });
  useEffect(() => {
    let active = true;
    function measure() {
      if (!active || typeof Taro.createSelectorQuery !== 'function') return;
      const windowHeight = typeof Taro.getWindowInfo === 'function' ? Taro.getWindowInfo().windowHeight : baseHeight.current;
      const available = Math.max(220, Math.min(windowHeight, baseHeight.current - keyboard.current));
      const bottom = Math.max(0, keyboard.current - Math.max(0, baseHeight.current - windowHeight));
      let header = 76, fixed = footer ? 86 : 0, extras = 0;
      const query = Taro.createSelectorQuery();
      query.select(`#${id}-header`).boundingClientRect(rect => { if (rect && !Array.isArray(rect)) header = rect.height + 18; });
      if (footer) query.select(`#${id}-footer`).boundingClientRect(rect => { if (rect && !Array.isArray(rect)) fixed = rect.height; });
      if (extra) query.select(`#${id}-extra`).boundingClientRect(rect => { if (rect && !Array.isArray(rect)) extras = rect.height; });
      query.select(`#${id}-content`).boundingClientRect(rect => {
        if (!active || !rect || Array.isArray(rect)) return;
        const height = Math.max(80, Math.min(rect.height, available * .89 - header - fixed - extras));
        setLayout(old => old.height === height && old.bottom === bottom ? old : { height, bottom });
      }).exec();
    }
    const schedule = () => typeof Taro.nextTick === 'function' ? Taro.nextTick(measure) : measure();
    const resized = (event: { height: number }) => { keyboard.current = Math.max(0, event.height); schedule(); };
    schedule(); Taro.onKeyboardHeightChange?.(resized);
    return () => { active = false; Taro.offKeyboardHeightChange?.(resized); };
  }, [children, footer, extra, tall, id]);
  return <View className="c-ui c-sheet-overlay" style={{ bottom: `${layout.bottom}px` }} catchMove onClick={close}><View className={`c-sheet ${tall ? 'c-sheet-tall' : ''} ${className}`} onClick={event => event.stopPropagation()}>
    <View className="c-sheet-grip"><View /></View><View id={`${id}-header`} className="c-sheet-heading"><Text>{title}</Text><Button className="c-close" ariaLabel="关闭弹层" onClick={close}><CIcon name="close" /><Text className="c-sr-only">关闭弹层</Text></Button></View>
    {extra && <View id={`${id}-extra`} className="c-sheet-extra">{extra}</View>}
    <ScrollView className="c-sheet-scroll" scrollY style={{ height: `${layout.height}px` }}><View className="c-sheet-body" id={`${id}-content`}>{children}</View></ScrollView>
    {footer && <View className="c-sheet-footer" id={`${id}-footer`}>{footer}</View>}
  </View></View>;
}
