import { generateKeyPairSync } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Creates disposable local/CI keys only. Never downloads a key or modifies cloud
// configuration, real .env files, or the original mini-program's AppSecret.
if (process.argv[2] !== '--fixture-only') throw new Error('Explicit --fixture-only is required');
const folder = resolve(import.meta.dirname, '../.working');
const pair = generateKeyPairSync('ed25519');
const common = [
  'WEEGO_CLOUD_AUTH_ENABLED=true', 'WECHAT_APP_ID=wx1111111111111111',
  'WEEGO_CLOUD_AUTH_ENV_ID=fixture-env', 'WEEGO_CLOUD_AUTH_KEY_ID=fixture-key',
  'WEEGO_CLOUD_AUTH_ALLOW_DEVTOOLS=false',
  `WEEGO_CLOUD_AUTH_PUBLIC_KEY_B64=${pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')}`
];
await mkdir(folder, { recursive: true });
await writeFile(resolve(folder, 'cloud-identity-api.fixture.env'), common.join('\n') + '\n', { mode: 0o600 });
await writeFile(resolve(folder, 'cloud-identity-test.fixture.env'), [...common,
  `WEEGO_CLOUD_AUTH_TEST_PRIVATE_KEY_B64=${pair.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64')}`
].join('\n') + '\n', { mode: 0o600 });
console.log('Created disposable identity fixture configuration; no real WeChat identity or cloud configuration used.');
