import { createElement, type PropsWithChildren } from '../../apps/miniprogram/node_modules/react';
type Props = Record<string, any>;
const storage = new Map<string, unknown>();
export const getToken = () => new URLSearchParams(location.search).get('view') === 'guest' ? undefined : 'offline-preview';
export const transport = async () => { throw new Error('OFFLINE_PREVIEW_NO_API'); };
export const api = new Proxy({}, { get: () => transport });
export const useDidHide = () => {};
export const useDidShow = () => {};
export const useUnload = () => {};
export const View = (p: Props) => createElement('view', { className: p.className, id: p.id, style: p.style }, p.children);
export const Text = (p: Props) => createElement('text', { className: p.className }, p.children);
export const Button = (p: Props) => createElement('button', { className: p.className, disabled: p.disabled, onClick: p.onClick, 'aria-label': p.ariaLabel }, p.children);
export const Label = (p: Props) => createElement('label', { className: p.className }, p.children);
export const Input = (p: Props) => createElement('input', { value: p.value, disabled: p.disabled, placeholder: p.placeholder, onChange: e => p.onInput?.({ detail: { value: e.currentTarget.value } }) });
export const Checkbox = (p: Props) => createElement('input', { type: 'checkbox', checked: p.checked, disabled: p.disabled, readOnly: true });
export const CheckboxGroup = (p: Props) => createElement('view', {}, p.children);
export const Image = (p: Props) => createElement('img', { className: p.className, src: p.src, style: p.style });
export const Canvas = (p: Props) => createElement('canvas', { id: p.id, width: parseFloat(p.style.width), height: parseFloat(p.style.height), style: p.style });
export const GatheringProfileBoundary = ({ children }: PropsWithChildren) => children;
export default {
  getStorageSync: (key: string) => storage.get(key), setStorageSync: (key: string, value: unknown) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key),
  pageScrollTo: async ({ selector }: Props) => document.querySelector(selector)?.scrollIntoView(),
  navigateTo: async () => { throw new Error('OFFLINE_PREVIEW_NO_NAVIGATION'); },
  nextTick: (callback: () => void) => setTimeout(callback, 0),
  createCanvasContext: (id: string) => {
    const ctx = (document.getElementById(id) as HTMLCanvasElement).getContext('2d')!;
    return new Proxy(ctx, { get(target, property) {
      if (property === 'setFillStyle') return (color: string) => { target.fillStyle = color; };
      if (property === 'setFontSize') return (size: number) => { target.font = `${size >= 28 ? 'bold' : 'normal'} ${size}px 'Microsoft YaHei',sans-serif`; };
      if (property === 'draw') return (_reserve: boolean, callback: () => void) => callback();
      const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
  },
  canvasToTempFilePath: async () => ({ tempFilePath: '/offline-preview-card.png' }),
  saveImageToPhotosAlbum: async () => { throw new Error('OFFLINE_PREVIEW_NO_ALBUM'); },
};
