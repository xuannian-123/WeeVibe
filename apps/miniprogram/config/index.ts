import { defineConfig } from '@tarojs/cli';
import path from 'node:path';
export default defineConfig<'webpack5'>({
  projectName: 'weego', date: '2026-10-24', designWidth: 750,
  sourceRoot: 'src', outputRoot: 'dist', framework: 'react', compiler: 'webpack5',
  cache: { enable: false },
  defineConstants: { __WEEGO_API_BASE_URL__: JSON.stringify(process.env.TARO_APP_API_BASE_URL ?? '') },
  mini: {
    compile: { include: [path.resolve(__dirname, '../../../packages')] },
    postcss: { pxtransform: { enable: true }, cssModules: { enable: false } }
  }
});
