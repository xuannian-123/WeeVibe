import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// Explicit release guard for the already-authorized public demo target.
// Does not build, connect, deploy, read .env, or change ordinary build defaults.
const expected = {
  TARO_APP_LOGIN_MODE: 'cloud', TARO_APP_API_TRANSPORT: 'cloud-http',
  TARO_APP_CLOUD_ENV_ID: 'cloud1-d2gl86h3t5a8b5369',
  TARO_APP_CLOUD_LOGIN_FUNCTION: 'weegoLogin20261025', TARO_APP_CLOUD_API_FUNCTION: 'weego-api-demo'
};
function read(root, path) { try { return readFileSync(resolve(root, path), 'utf8'); } catch { throw new Error(`Required artifact file missing: ${path}`); } }
function json(root, path) { try { return JSON.parse(read(root, path)); } catch { throw new Error(`Public JSON cannot be validated: ${path}`); } }
const esc = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
try {
  const args = process.argv.slice(2);
  assert(args.length === 0 || args.length === 2 && args[0] === '--project-root', 'Only --project-root PATH is supported');
  const root = args.length ? resolve(args[1]) : fileURLToPath(new URL('../', import.meta.url));
  const config = json(root, 'config/miniprogram-demo.json');
  assert(config && typeof config === 'object' && Object.keys(config).length === Object.keys(expected).length && Object.entries(expected).every(([key, value]) => config[key] === value), 'Public demo configuration differs from the authorized target');
  for (const [path, miniRoot] of [['apps/miniprogram/project.config.json', 'dist/'], ['apps/miniprogram/dist/project.config.json', './']]) {
    const p = json(root, path);
    assert(p.appid === 'wxaa06e111e33f6ddd', 'AppID must remain the authorized demo AppID');
    assert(p.setting?.urlCheck === true, 'urlCheck must remain enabled');
    assert(p.libVersion === '3.16.2', 'Base library version changed');
    assert(p.miniprogramRoot === miniRoot, 'Unexpected mini entry directory');
    assert(p.compileType === 'miniprogram', 'Unexpected compile target');
  }
  const common = read(root, 'apps/miniprogram/dist/common.js');
  const env = esc(JSON.stringify(expected.TARO_APP_CLOUD_ENV_ID)), api = esc(JSON.stringify(expected.TARO_APP_CLOUD_API_FUNCTION)), login = esc(JSON.stringify(expected.TARO_APP_CLOUD_LOGIN_FUNCTION));
  // Taro 4.3.1 eliminates mode constants. Verify compiled executable call shapes,
  // not merely an unused string or the source configuration file.
  assert(new RegExp(`return [^;{}]{0,120}\\.a\\(2,[A-Za-z_$][\\w$]*\\([A-Za-z_$][\\w$]*,${env},${api}\\)\\)`).test(common), 'Compiled cloud-http return branch is absent or targets another function');
  assert(new RegExp(`\\.cloud\\.init\\(\\{env:${env}\\}\\)`).test(common), 'Compiled cloud login initialization is missing');
  assert(new RegExp(`\\.cloud\\.callFunction\\(\\{name:${login},data:\\{\\},config:\\{env:${env}\\}\\}\\)`).test(common), 'Compiled login call is missing or targets another function');
  // Bind the actual generator entry to the adjacent cloud branch. The code-mode
  // build retains dead cloud calls, so presence of callFunction alone is not proof.
  const identifier = '[A-Za-z_$][\\w$]*';
  const generatorEntry = `\\.w\\(function\\((${identifier})\\)\\{while\\(1\\)switch\\(\\1\\.p=\\1\\.n\\)\\{`;
  const cloudEntry = `${generatorEntry}case 0:0,\\1\\.n=1;break;case 1:return ${identifier}\\(\\),\\1\\.p=2,${identifier}\\(\\)\\.cloud\\.init\\(\\{env:${env}\\}\\),\\1\\.n=3,${identifier}\\(\\)\\.cloud\\.callFunction\\(\\{name:${login},data:\\{\\},config:\\{env:${env}\\}\\}\\)`;
  assert(new RegExp(cloudEntry).test(common), 'Compiled login entry does not enter the authorized cloud branch');
  const transportEntry = `${generatorEntry}case 0:return ${identifier}\\(\\),\\1\\.a\\(2,${identifier}\\(${identifier},${env},${api}\\)\\)`;
  assert(new RegExp(transportEntry).test(common), 'Compiled transport entry does not return through cloud-http');
  const app = json(root, 'apps/miniprogram/dist/app.json');
  assert(Array.isArray(app.pages) && app.pages.includes('pages/index/index'), 'Compiled app entry is missing');
  const locationDescription = app.permission?.['scope.userFuzzyLocation']?.desc;
  assert(typeof locationDescription === 'string' && locationDescription.trim().length > 0 && Array.from(locationDescription).length <= 30, 'Compiled location permission description must contain 1-30 characters');
  assert(Array.isArray(app.requiredPrivateInfos) && app.requiredPrivateInfos.includes('getFuzzyLocation'), 'Compiled location interface declaration is missing');
  assert(!app.requiredPrivateInfos.includes('getLocation') && !app.permission?.['scope.userLocation'], 'Rejected precise location must not remain declared');
  console.log(JSON.stringify({ pass: true, target: 'existing_shared_demo', artifact: 'compiled_cloud_login_and_cloud_http', common_sha256: createHash('sha256').update(common).digest('hex'), appid: 'wxaa06e111e33f6ddd', urlCheck: true, remote_calls: 0 }));
} catch (error) { console.error(error instanceof Error ? error.message : 'Configured artifact validation failed'); process.exitCode = 1; }
