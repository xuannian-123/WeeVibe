import { expect, it } from 'vitest';
import { applyToActivityInputSchema } from '../packages/contracts/src/activities';
it('desired invitation provenance is accepted by the application request contract', () => {
 expect(applyToActivityInputSchema.safeParse({ idempotency_key: 'attribution-before', expected_revision: 1,
 segments: [{ segment_id: '00000000-0000-4000-8000-000000000002', plan_revision: 1 }],
 invitation_source_id: '00000000-0000-4000-8000-000000000031' }).success).toBe(true);
});
it('existing direct application remains a valid control', () => {
 expect(applyToActivityInputSchema.safeParse({ idempotency_key: 'attribution-control', expected_revision: 1,
 segments: [{ segment_id: '00000000-0000-4000-8000-000000000002', plan_revision: 1 }] }).success).toBe(true);
});
