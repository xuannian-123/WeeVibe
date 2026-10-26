import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = resolve('scripts/build-mini-demo.mjs');

describe('explicit shared-demo build configuration', () => {
  it('selects cloud login and native HTTP without revealing inherited server secrets', () => {
    const output = execFileSync(process.execPath, [script, '--check'], {
      encoding: 'utf8',
      env: { ...process.env, AI_API_KEY: 'private-test-marker', DATABASE_URL: 'private-db-marker', TARO_APP_API_BASE_URL: 'https://wrong.invalid', TARO_APP_LOGIN_MODE: 'code' },
    });
    const result = JSON.parse(output);
    expect(result.settings.TARO_APP_LOGIN_MODE).toBe('cloud');
    expect(result.settings.TARO_APP_API_TRANSPORT).toBe('cloud-http');
    expect(result.settings.TARO_APP_API_BASE_URL).toBe('');
    expect(result.deploys_backend).toBe(false);
    expect(result.changes_wechat_version).toBe(false);
    expect(output).not.toContain('private-');
    expect(output).not.toContain('wrong.invalid');
  });

  it('rejects extra configuration fields before any build can start', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'weevibe-demo-config-'));
    try {
      mkdirSync(join(fixture, 'scripts'));
      mkdirSync(join(fixture, 'config'));
      writeFileSync(join(fixture, 'scripts/build-mini-demo.mjs'), readFileSync(script));
      const config = JSON.parse(readFileSync(resolve('config/miniprogram-demo.json'), 'utf8'));
      writeFileSync(join(fixture, 'config/miniprogram-demo.json'), JSON.stringify({ ...config, AI_API_KEY: 'private-test-marker' }));
      const result = spawnSync(process.execPath, [join(fixture, 'scripts/build-mini-demo.mjs'), '--check'], { encoding: 'utf8' });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Invalid public demo configuration');
      expect(result.stdout).toBe('');
      expect(result.stderr).not.toContain('private-test-marker');
    } finally {
      // mkdtemp's absolute result is the only directory this test owns.
      if (resolve(fixture).startsWith(resolve(tmpdir()) + '\\') || resolve(fixture).startsWith(resolve(tmpdir()) + '/')) {
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  });
});
