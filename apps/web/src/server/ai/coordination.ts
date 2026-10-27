import { coordinationGenerateRequestSchema } from '@weevibe/contracts/src/coordination-source';
import { coordinationSuggestionSchema, type CoordinationSuggestion } from '@weevibe/contracts/src/coordination-proposal';
import { aiSnapshotSchema } from '@weevibe/contracts/src/ai';
import { readCoordinationSourceOnce, type CoordinationSource } from '../requirements/coordination-source';
import { ServiceError } from '../http';
import { validateTimeCoordination } from './constraints';

type ProviderInput = { snapshot: CoordinationSource['snapshot']; aggregate: CoordinationSource['context']['aggregate']; apply_intent: false };
/** Injection seam for offline contract tests / a future explicitly configured adapter.
 * The production route deliberately has NO provider and never falls back to creation AI. */
export type CoordinationProvider = { generate: (input: ProviderInput) => Promise<unknown> };
type Options = { readSource?: typeof readCoordinationSourceOnce; provider?: CoordinationProvider };
const stale = () => new ServiceError('VERSION_CONFLICT', 409, '活动、管理权限或需求来源已变化，请重新读取汇总；旧建议不能继续使用。');
const invalid = () => new ServiceError('UPSTREAM_UNAVAILABLE', 503, '候选建议未通过当前来源和时间规则检查，结果未采用；原活动和需求均未改变。');

export function createCoordinationBoundary(options: Options = {}) {
  const read = options.readSource ?? readCoordinationSourceOnce;
  async function current(collectionId: string, actorId: string) {
    // Separate RepeatableRead transactions: repeating within one transaction
    // would keep the old snapshot and would not revalidate a management change.
    const first = await read(collectionId, actorId);
    const latest = await read(collectionId, actorId);
    if (first.context.source_fingerprint !== latest.context.source_fingerprint || first.context.collection_id !== latest.context.collection_id || first.context.activity_id !== latest.context.activity_id) throw stale();
    return latest;
  }
  return {
    async prepare(collectionId: string, actorId: string) {
      return (await current(collectionId, actorId)).context;
    },
    async generate(collectionId: string, actorId: string, raw: unknown): Promise<CoordinationSuggestion> {
      const parsed = coordinationGenerateRequestSchema.safeParse(raw);
      if (!parsed.success) throw new ServiceError('INVALID_INPUT', 400, '请使用刚读取的需求来源标识；不接受客户端伪造的答卷、身份或安排。');
      const original = await current(collectionId, actorId);
      if (original.context.source_fingerprint !== parsed.data.expected_source_fingerprint) throw stale();
      if (!options.provider) throw new ServiceError('NOT_CONFIGURED', 503, '多人协调模型适配尚未接通；当前仅提供汇总与接口准备，未生成候选，原活动不变。');
      let rawProposal: unknown;
      try {
        // A provider must not mutate the trusted source used by validation.
        const input: ProviderInput = { snapshot: aiSnapshotSchema.parse(original.snapshot), aggregate: structuredClone(original.context.aggregate), apply_intent: false };
        rawProposal = await options.provider.generate(structuredClone(input));
        const encoded = JSON.stringify(rawProposal);
        if (!encoded || Buffer.byteLength(encoded, 'utf8') > 65_536) throw invalid();
      } catch { throw invalid(); }
      // Do not hold a DB lock while awaiting an external adapter. Re-read all
      // authorization, answer versions and time phases before accepting output.
      const latest = await current(collectionId, actorId);
      if (latest.context.source_fingerprint !== original.context.source_fingerprint) throw stale();
      const checked = validateTimeCoordination(latest.snapshot, rawProposal, latest.validatorActorId);
      if (!checked.ok) throw invalid();
      const { affected_member_ids: _members, explanation: _modelText, unknowns, ...candidate } = checked.value;
      const explanation = candidate.status === 'proposed'
        ? '仅通过限定时间规则检查，未应用；转场、可用性和未结构化偏好仍需人工核对。'
        : candidate.status === 'needs_info'
          ? '当前信息不足，未产生可应用安排；未自动省略任何人的需求。'
          : '未找到建议不代表不存在可行安排；未改变活动或排除任何人。';
      return coordinationSuggestionSchema.parse({
        source_fingerprint: latest.context.source_fingerprint, source_validated_at: latest.snapshot.now,
        can_apply: false, validation_scope: 'program_time_checks_only',
        candidate: { ...candidate, affected_member_count: checked.computed.affected_member_ids.length,
          unknowns: unknowns.map(({ code, segment_id }) => ({ code, segment_id })), explanation }
      });
    }
  };
}
export const coordinationBoundary = createCoordinationBoundary();
