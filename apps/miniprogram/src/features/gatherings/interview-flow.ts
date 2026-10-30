import { gatheringDateSchema, gatheringIntakeSchema, gatheringSections, privateGatheringInputText, privateGatheringMoneyText, type GatheringIntake } from '@weevibe/contracts';

/** Nickname is the existing prerequisite, outside these five substantive questions. */
export const interviewQuestions = [
  { id: 'availability', title: '哪天、什么时间有空？', private: false },
  { id: 'origin', title: '你准备从哪出发？', private: true },
  { id: 'budget', title: '这次你的预算是多少？', private: true },
  { id: 'do', title: '这次想吃、喝、玩些什么？', private: false },
  { id: 'preferences', title: '你想要什么，又想避开什么？', private: false },
] as const;
export type InterviewPatch = { public?: Partial<GatheringIntake['public']>; private?: Partial<GatheringIntake['private']> };
export type InterviewParseResult = { status: 'accepted'; patch: InterviewPatch; acknowledgement: string } | { status: 'clarify'; message: string; privateNotice?: boolean };
const clarify = (message: string, privateNotice = false): InterviewParseResult => ({ status: 'clarify', message, ...(privateNotice ? { privateNotice: true } : {}) });
const flexible = /^(?:都行|都可以|随便|你定|愿意配合|没有要求|没要求|不限|无要求)[。！!\s]*$/;

function appendDistinctNote(previous: string, text: string): string {
  // Replaying or revisiting the same answer must not grow the shared note. Keep
  // original wording and avoid substring matching (“散步” and “想散步” differ).
  const normalized = text.replace(/\r\n/g, '\n').trim();
  const existing = previous.replace(/\r\n/g, '\n');
  if (existing === normalized || existing.split('\n').some(line => line.trim() === normalized)) return previous;
  if (`\n${existing}\n`.includes(`\n${normalized}\n`)) return previous;
  return previous ? `${previous}\n${text}` : text;
}

/** No network, storage, model calls or automatic confirmation occurs in this module. */
export function applyInterviewPatch(intake: GatheringIntake, patch: InterviewPatch): GatheringIntake {
  return gatheringIntakeSchema.parse({
    ...intake,
    public: { ...intake.public, ...patch.public, keywords: { ...intake.public.keywords, ...patch.public?.keywords }, confirmed_keys: patch.public ? [] : [...intake.public.confirmed_keys] },
    private: { ...intake.private, ...patch.private, confirmed_keys: patch.private ? [] : [...intake.private.confirmed_keys] },
  });
}
function accepted(intake: GatheringIntake, patch: InterviewPatch, acknowledgement: string): InterviewParseResult {
  try { applyInterviewPatch(intake, patch); } catch { return clarify('这条回答还不能完整记录，请检查金额、日期或文字长度，也可以使用下面的填写卡片。'); }
  return { status: 'accepted', patch, acknowledgement };
}
function parseBudget(text: string, intake: GatheringIntake): InterviewParseResult {
  if (!text || flexible.test(text)) return accepted(intake, { private: { budget_min: null, budget_max: null, budget_note: '' } }, '预算先按愿意配合记录，不代表免费或同意最终安排。');
  if (text.length > 200 || /左右|差不多|大概|多一点|多点|百|千|万|几|多元|多块/.test(text)) return clarify('预算想控制在多少元以内，还是一个范围？例如“200以内”或“100到200”。');
  const normalized = text.replace(/[０-９]/g, digit => String(digit.charCodeAt(0) - 0xff10));
  if (/(?:^|[^\d])[-−]\d/.test(normalized) && !/^\d+(?:\.\d+)?\s*[-－–~～]/.test(normalized)) return clarify('预算不能为负数，请填写0元或以上的金额。');
  const number = '(\\d+(?:\\.\\d+)?)';
  const prefix = '(?:我的|这次|人均|预算|大约|约|是|为|\\s|[¥￥])*';
  const units = '(?:元|块钱|块|人民币)?';
  const range = new RegExp(`^${prefix}${number}\\s*${units}\\s*(?:到|至|[-－–~～])\\s*[¥￥]?${number}\\s*${units}$`).exec(normalized);
  let min: number | null = null, max: number | null = null;
  if (range) { min = Number(range[1]); max = Number(range[2]); }
  else {
    const low = new RegExp(`^${prefix}(?:至少|最低|不少于)\\s*${number}\\s*${units}$`).exec(normalized);
    const high = new RegExp(`^${prefix}(?:(?:最多|最高|不超过|上限)\\s*)?${number}\\s*${units}\\s*(?:以内|以下|封顶)?$`).exec(normalized);
    if (low) min = Number(low[1]); else if (high) max = Number(high[1]); else return clarify('这条预算有些不明确，请给一个上限或区间，例如“200以内”或“100到200”。');
  }
  const valid = (value: number | null) => value === null || Number.isFinite(value) && value >= 0 && value <= 1_000_000 && Math.abs(value * 100 - Math.round(value * 100)) < .000001;
  if (!valid(min) || !valid(max)) return clarify('金额需在0到100万元之间，最多保留两位小数，请重新确认。');
  if (min !== null && max !== null && min > max) return clarify('最低预算比最高预算高了，请确认你想要的范围。');
  return accepted(intake, { private: { budget_min: min, budget_max: max, budget_note: intake.private.budget_note } }, `${min === null ? `先按最高${max}元` : max === null ? `先按最低${min}元` : `先按${min}到${max}元`}记录，仅本人可见；这仍是偏好，不代表场地报价或最终同意。`);
}

export function parseInterviewAnswer(index: number, raw: string, intake: GatheringIntake): InterviewParseResult {
  if (!interviewQuestions[index]) return clarify('请先选择要修改的那一题。');
  const text = raw.trim();
  if (index === 2) return parseBudget(text, intake);
  if (index === 1) {
    if (!text || flexible.test(text)) return accepted(intake, { private: { origin: null } }, '出发地点先按愿意配合记录，只在你的私人栏位保留。');
    if (privateGatheringMoneyText.test(text)) return clarify('这一题先填写出发地点，预算请放在下一题的私人预算栏。', true);
    if (text.length > 300) return clarify('出发地点请控制在300字以内，也可以使用地点选择卡片。', true);
    return accepted(intake, { private: { origin: { label: text } } }, '出发地点先按你写的文字记录，仅本人可见；尚未核实坐标。');
  }
  if (!text) return clarify('可以说说你的想法，也可以明确选择愿意配合；我不会把空白当成你已回答。');
  if (privateGatheringInputText.test(text)) return clarify('这句话含有预算或个人出发地点，请放进对应的私人填写卡片，不会写入公开想法。', true);
  if (index === 0) {
    if (text.length > 200) return clarify('可用时间请控制在200字以内。');
    const dates = [...text.matchAll(/\d{4}-\d{1,2}-\d{1,2}/g)].map(match => match[0].split('-').map((part, i) => i ? part.padStart(2, '0') : part).join('-'));
    if (dates.length > 1) return clarify('目前一次保留一个出游日期，请选一个日期，其余时间偏好可写在说明中。');
    if (dates[0] && !gatheringDateSchema.safeParse(dates[0]).success) return clarify('这个日期暂时无法确认，请使用日期卡片重新选择。');
    return accepted(intake, { public: { availability: flexible.test(text) ? '时间愿意配合' : text, ...(dates[0] ? { date: dates[0] } : {}) } }, '可用时间先这样记录；没有明确的新日期会沿用当前出游日期，最后再由你核对。');
  }
  const sections = gatheringSections.filter(section => index === 3 ? section.id === 'do' : section.id !== 'do');
  const keywords = { ...intake.public.keywords };
  if (flexible.test(text)) {
    for (const section of sections) for (const group of section.groups) keywords[group.id] = [];
    return accepted(intake, { public: { keywords } }, '这一题先按愿意配合记录，没有新增限制；已有补充文字仍留给你核对。');
  }
  const clauses = text.split(/[，,。；;！!]|但是|不过|然后|但/).filter(Boolean);
  for (const section of sections) for (const group of section.groups) {
    const selected = new Set(keywords[group.id]);
    for (const option of group.options) {
      if (option === '其他' || option === '都可以') continue;
      const aliases = [option, ...option.split(/[／/：（）()]/)].filter(value => value.length >= 2);
      for (const clause of clauses) for (const alias of aliases) {
        const position = clause.indexOf(alias); if (position < 0) continue;
        const before = clause.slice(0, position);
        const negative = /不想|不要|不吃|不喝|不玩|不喜欢|避免|不考虑/.test(before);
        const accepts = /不介意|可以接受|能接受/.test(before);
        if (section.id === 'avoid') {
          if (accepts) selected.delete(option);
          else if (!negative && /喜欢|希望|想要/.test(before)) return clarify('你提到的这一项通常属于“想避开”。请确认是想要还是想避开，原文尚未应用。');
          else selected.add(option);
        } else if (negative) selected.delete(option); else selected.add(option);
      }
    }
    keywords[group.id] = [...selected];
  }
  const note = appendDistinctNote(intake.public.note, text);
  if (note.length > 1000) return clarify('补充想法累计超过1000字，请精简后再记录。');
  return accepted(intake, { public: { keywords, note } }, '已把能明确对应的选项放进草稿，并保留你的原话；想要和想避开会分开，最后由你核对。');
}

export function interviewAnswerSummary(index: number, intake: GatheringIntake, answered = false): string {
  if (index === 0) return [intake.public.date, intake.public.availability].filter(Boolean).join(' · ') || '尚未填写时间';
  if (index === 1) return intake.private.origin?.label || (answered ? '愿意配合其他人的安排' : '尚未填写出发地点');
  if (index === 2) return [intake.private.budget_min === null || !Number.isFinite(intake.private.budget_min) ? '' : `最低${intake.private.budget_min}元`, intake.private.budget_max === null || !Number.isFinite(intake.private.budget_max) ? '' : `最高${intake.private.budget_max}元`, intake.private.budget_note].filter(Boolean).join('，') || (answered ? '愿意配合其他人的安排' : '尚未填写预算');
  if (index !== 3 && index !== 4) return '';
  const sections = gatheringSections.filter(section => index === 3 ? section.id === 'do' : section.id !== 'do');
  const values = sections.flatMap(section => section.groups.flatMap(group => intake.public.keywords[group.id].map(option => `${group.title}：${intake.public.keyword_notes?.[group.id as 'eat'|'drink'|'play']?.startsWith(option+'：')?intake.public.keyword_notes[group.id as 'eat'|'drink'|'play']:option}`)));
  return [...values, ...(index === 4 && intake.public.note ? [intake.public.note] : [])].join('；') || '暂无已选偏好，请核对后继续';
}
export function interviewAcknowledgement(index: number, intake: GatheringIntake): string {
  if (index === 1 || index === 2) return '这一项只留在你的私人栏位，不会发送给整理模型。';
  return index === 0 ? '时间先记在草稿里，后面可以回来修改。' : '先按这些公开偏好整理，哪些已经确定由你最后选择。';
}
