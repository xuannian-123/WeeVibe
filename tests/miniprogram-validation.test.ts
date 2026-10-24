import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('validates shared sessions without dynamic code in the mini-program runtime', () => {
  // A separate process keeps the client-only Zod configuration out of API tests.
  const result = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', `
    import assert from 'node:assert/strict';
    let attempts = 0;
    globalThis.Function = new Proxy(globalThis.Function, {
      construct() { attempts++; throw new Error('Dynamic code is unavailable'); },
      apply() { attempts++; throw new Error('Dynamic code is unavailable'); }
    });
    await import('./apps/miniprogram/src/platform/validation.ts');
    const { sessionSchema } = await import('./packages/contracts/src/index.ts');
    const valid = {
      token: 'a'.repeat(43),
      user: { user_id: '550e8400-e29b-41d4-a716-446655440000' },
      expires_at: '2030-01-01T00:00:00.000Z'
    };
    assert.equal(sessionSchema.safeParse(valid).success, true);
    assert.equal(sessionSchema.safeParse({ ...valid, user: { user_id: 'invalid' } }).success, false);
    assert.equal(attempts, 0);
    console.log('validated-without-dynamic-code');
  `], { encoding: 'utf8', timeout: 20000 });
  expect(result.trim()).toBe('validated-without-dynamic-code');
});
