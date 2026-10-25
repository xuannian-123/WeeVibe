import { defineConfig } from '@tarojs/cli';
import path from 'node:path';
const loginMode = process.env.TARO_APP_LOGIN_MODE ?? 'code';
if (!['code', 'cloud'].includes(loginMode)) throw new Error('TARO_APP_LOGIN_MODE must be code or cloud');
const apiTransport = process.env.TARO_APP_API_TRANSPORT ?? 'https';
if (!['https', 'cloud-http'].includes(apiTransport)) throw new Error('TARO_APP_API_TRANSPORT must be https or cloud-http');
export default defineConfig<'webpack5'>({
  projectName: 'WeeVibe', date: '2026-10-24', designWidth: 750,
  sourceRoot: 'src', outputRoot: 'dist', framework: 'react', compiler: 'webpack5',
  cache: { enable: false },
  defineConstants: {
    __WEEGO_API_BASE_URL__: JSON.stringify(process.env.TARO_APP_API_BASE_URL ?? ''),
    __WEEGO_API_TRANSPORT__: JSON.stringify(apiTransport),
    __WEEGO_CLOUD_API_FUNCTION__: JSON.stringify(process.env.TARO_APP_CLOUD_API_FUNCTION ?? ''),
    __WEEGO_LOGIN_MODE__: JSON.stringify(loginMode),
    __WEEGO_CLOUD_ENV_ID__: JSON.stringify(process.env.TARO_APP_CLOUD_ENV_ID ?? ''),
    __WEEGO_CLOUD_LOGIN_FUNCTION__: JSON.stringify(process.env.TARO_APP_CLOUD_LOGIN_FUNCTION ?? '')
  },
  mini: {
    compile: { include: [path.resolve(__dirname, '../../../packages')] },
    postcss: { pxtransform: { enable: true }, cssModules: { enable: false } }
  }
});
