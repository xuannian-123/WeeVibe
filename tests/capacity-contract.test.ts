import { describe, expect, it } from 'vitest';
import { changeCapacityInputSchema, apiErrorSchema } from '../packages/contracts/src';
import { createApiClient } from '../packages/api-client/src';
const input = { idempotency_key: 'capacity-contract-key', expected_revision: 1, expected_capacity: 8, capacity: 4 };
describe('WG05 strict capacity-only input', () => {
  it('exports independent schema and dedicated API method', () => { expect(changeCapacityInputSchema.parse(input)).toEqual(input); expect(createApiClient(async () => ({ status: 503, body: {} }))).toHaveProperty('changeCapacity'); });
  it.each(['expected_revision', 'expected_capacity', 'capacity'])('requires a positive database integer for %s', field => { for (const value of [0, -1, 1.5, '4', Infinity, NaN, 2147483648, undefined]) expect(changeCapacityInputSchema.safeParse({ ...input, [field]: value }).success).toBe(false); });
  it('rejects same-capacity no-op before a transaction', () => { expect(changeCapacityInputSchema.safeParse({ ...input, capacity: 8 }).success).toBe(false); });
  it.each(['actor_id', 'segment_id', 'minimum_participants', 'fee', 'requirements', 'plan_revision', 'occupied_count', 'confirmed', 'verification_status', 'booking_status', 'starts_at'])('never accepts %s mutation as capacity input', field => { expect(changeCapacityInputSchema.safeParse({ ...input, [field]: 1 }).success).toBe(false); });
  it.each(['CAPACITY_BELOW_OCCUPIED', 'CAPACITY_BELOW_MINIMUM', 'CAPACITY_CHANGE_CLOSED', 'CAPACITY_SCOPE_UNAVAILABLE'])('retains explicit %s API error', code => { expect(apiErrorSchema.safeParse({ error: { code, message: '明确错误' }, request_id: 'fixture' }).success).toBe(true); });
});
