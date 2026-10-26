import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Explicit opt-in to the existing shared demo. Never read backend .env files.
const root = fileURLToPath(new URL('../', import.meta.url));
const keys = ['TARO_APP_LOGIN_MODE', 'TARO_APP_API_TRANSPORT', 'TARO_APP_CLOUD_ENV_ID', 'TARO_APP_CLOUD_LOGIN_FUNCTION', 'TARO_APP_CLOUD_API_FUNCTION'];
const config = JSON.parse(readFileSync(new URL('../config/miniprogram-demo.json', import.meta.url), 'utf8'));
if (!config || typeof config !== 'object' || Array.isArray(config) || Object.keys(config).length !== keys.length ||
  !keys.every(key => Object.hasOwn(config, key) && typeof config[key] === 'string' && /^[A-Za-z0-9_-]+$/.test(config[key])) ||
  config.TARO_APP_LOGIN_MODE !== 'cloud' || config.TARO_APP_API_TRANSPORT !== 'cloud-http') {
  throw new Error('Invalid public demo configuration; only the documented client connection fields are allowed.');
}
if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Only --check is supported.');
const settings = { ...config, TARO_APP_API_BASE_URL: '' };
console.log(JSON.stringify({ target: 'existing_shared_demo', settings, deploys_backend: false, changes_wechat_version: false }));
if (!process.argv.includes('--check')) {
  const windows = process.platform === 'win32';
  const command = windows ? 'cmd.exe' : 'pnpm';
  const args = windows ? ['/d', '/s', '/c', 'pnpm --filter @weevibe/miniprogram build'] : ['--filter', '@weevibe/miniprogram', 'build'];
  const result = spawnSync(command, args, { cwd: root, env: { ...process.env, ...settings }, stdio: 'inherit', windowsHide: true });
  if (result.error) { console.error('Could not start pnpm. Install the repository-required runtime and dependencies first.'); process.exitCode = 1; }
  else process.exitCode = result.status ?? 1;
}
