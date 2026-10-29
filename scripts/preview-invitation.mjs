// Offline visual evidence from real invitation components and CSS. No network or business API.
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const requireApp = createRequire(new URL('../apps/miniprogram/package.json', import.meta.url));
const requireMini = createRequire(requireApp.resolve('vite/package.json'));
const { build } = requireMini('esbuild');
const out = path.join(root, 'outputs/invitation-preview');
await mkdir(out, { recursive: true });
await build({
  absWorkingDir: root, entryPoints: ['scripts/fixtures/invitation-preview.tsx'], outfile: path.join(out, 'preview.js'),
  bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.png': 'file' },
  assetNames: 'assets/[name]-[hash]', define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'offline-native-adapter', setup(builder) {
    const reactRequire = createRequire(new URL('../apps/miniprogram/package.json', import.meta.url));
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, args => ({ path: reactRequire.resolve(args.path) }));
    const adapter = path.join(root, 'scripts/fixtures/invitation-preview-platform.tsx');
    builder.onResolve({ filter: /^@tarojs\/(taro|components)$/ }, () => ({ path: adapter }));
    builder.onResolve({ filter: /platform\/api$/ }, () => ({ path: adapter }));
    builder.onResolve({ filter: /gatherings\/profile-boundary$/ }, () => ({ path: adapter }));
  } }],
});
const css = await Promise.all(['apps/miniprogram/src/app.css', 'apps/miniprogram/src/design-c.css', 'apps/miniprogram/src/features/activity-detail/activity.css', 'apps/miniprogram/src/features/activity-entry/invitation-overview.css', 'apps/miniprogram/src/features/share-card/share-card.css'].map(file => readFile(path.join(root, file), 'utf8')));
// Taro designWidth=750 pxtransform equivalent for this offline browser proof only.
const scaled = css.join('\n').replace(/(-?\d*\.?\d+)px/g, (_, value) => `${Number(value) / 7.5}vw`);
await writeFile(path.join(out, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WeeVibe 活动详情与分享预览</title><style>${scaled}\n*{box-sizing:border-box}body{margin:0;background:#F8F6F0;font-family:-apple-system,'Microsoft YaHei',sans-serif}view{display:block}button{display:block;width:100%;font-family:inherit;border:0}text{overflow-wrap:anywhere}img{object-fit:contain}input[type=checkbox]{width:5vw;height:5vw;flex-shrink:0;accent-color:#222}.preview-label{padding:10px 14px;background:#222;color:#fff;font-size:11px;line-height:1.5}.preview-label a{color:#A7F05A;margin-right:12px}#root>.screen{padding-top:4vw}.iv-animal-grid img{max-width:100%}.activity-facts>view{flex:1;min-width:0}</style><div class="preview-label">离线示例 · 可切换状态 · 不会发送报名或审批<br><a href="?view=guest">游客</a><a href="?view=pending">待审批</a><a href="?view=participant">已加入</a><a href="?view=changed">待重接受</a><a href="?view=cancelled">已取消</a><a href="?view=manager">组织者</a><a href="?view=long">长中文</a><a href="?view=card">分享图</a></div><div id="root"></div><script src="preview.js"></script></html>`, 'utf8');
console.log('Offline preview: outputs/invitation-preview/index.html (synthetic fixtures, no real API)');
