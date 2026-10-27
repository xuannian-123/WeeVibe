import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as contracts from '../packages/contracts/src/activities';
import { createApiClient } from '../packages/api-client/src';

describe('own pending application withdrawal entry contract', () => {
  it('has a dedicated contract, separate from approval or leaving joined seats', () => {
    expect(contracts).toHaveProperty('withdrawApplicationInputSchema');
  });
  it('has a dedicated API client operation and server route', () => {
    expect(createApiClient(async () => ({ status: 500, body: {} }))).toHaveProperty('withdrawApplication');
    expect(existsSync('apps/web/src/app/api/v1/activities/[activityId]/applications/[applicationId]/withdraw/route.ts')).toBe(true);
  });
  it('accepts only the original operation key and activity version', () => {
    const schema = contracts.withdrawApplicationInputSchema;
    const input = { idempotency_key: 'withdraw-original-key', expected_revision: 1 };
    expect(schema.parse(input)).toEqual(input);
    for (const extra of [{ user_id: 'forged' }, { segments: [] }, { decision: 'approve' }, { fee: 0 }, { exit: true }]) {
      expect(schema.safeParse({ ...input, ...extra }).success).toBe(false);
    }
    expect(schema.safeParse({ ...input, expected_revision: 0 }).success).toBe(false);
    expect(schema.safeParse({ ...input, idempotency_key: 'x' }).success).toBe(false);
  });
});
