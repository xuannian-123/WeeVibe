import { parseDraft } from './rules';
export type RequirementMessageSource = {
 id: string; kind: string; activityId: string | null; draft: unknown; status: string; revision: number;
 deadlineAt: Date | null; closedAt: Date | null; updatedAt: Date;
};
export type RequirementMessage = { id: string; activity_id: string | null; requirement_id: string; title: string; created_at: string; read: boolean };
/** Sources must be selected by current manager/own submission before calling. No answer or origin is used. */
export function requirementMessages(source: RequirementMessageSource, readIds: Set<string>, now: Date): RequirementMessage[] {
 if (source.kind !== 'friend' || source.status === 'draft' || !source.deadlineAt) return [];
 const closedAt = source.closedAt && source.closedAt < source.deadlineAt ? source.closedAt : source.deadlineAt;
 if (closedAt > now) return [];
 const title = parseDraft(source.draft).title;
 const closedId = `requirement:${source.id}:closed:${closedAt.getTime()}`;
 const result: RequirementMessage[] = [{ id: closedId, activity_id: source.activityId, requirement_id: source.id,
   title: `${title}：需求收集已截止`, created_at: closedAt.toISOString(), read: readIds.has(closedId) }];
 if (source.status === 'finalized') {
  const finalId = `requirement:${source.id}:finalized:${source.revision}`;
  result.push({ id: finalId, activity_id: source.activityId, requirement_id: source.id,
   title: `${title}：定案建议已更新，需另看正式活动安排`, created_at: source.updatedAt.toISOString(), read: readIds.has(finalId) });
 }
 return result;
}
export function parseRequirementMessageId(raw: unknown) {
 if (typeof raw !== 'string') throw new Error('消息编号无效');
 const match = /^requirement:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(closed|finalized):([1-9][0-9]{0,14})$/.exec(raw);
 if (!match) throw new Error('消息编号无效');
 return { collectionId: match[1], id: raw };
}
export const requirementMessageSelect = { id:true, kind:true, activityId:true, draft:true, status:true, revision:true, deadlineAt:true, closedAt:true, updatedAt:true } as const;
