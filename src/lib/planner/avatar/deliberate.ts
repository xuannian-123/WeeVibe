// v6 分身讨论之后局长怎么定（docs/AVATAR.md 第 4 节）：
// 只在"一样公平"的方案之间选（照顾到的人一样多、最吃亏的人损失差不多——规则保底，讨论不能为了谁的喜好牺牲别人），
// 其中分身们呼声最高的那个胜出：支持 +1，为它主动让一步再 +0.5，反对 −1；打平按规则的原顺序（推荐方案在前）。
// 纯函数：同一份讨论记录一定得到同一个结论（记录存在 ju_private.live.stances 里，可以复算）。

export type Stance = {
  /** 分身代号 */
  code: string;
  /** 支持 / 反对的方案 id */
  support?: string;
  oppose?: string;
  /** 为支持的方案在授权内主动让一步 */
  offer?: boolean;
};

export const SUPPORT_W = 1;
export const OFFER_W = 0.5;
export const OPPOSE_W = 1;

export function supportScores(optionIds: string[], stances: Stance[]): Record<string, number> {
  const score: Record<string, number> = Object.fromEntries(optionIds.map((id) => [id, 0]));
  for (const s of stances) {
    if (s.support && s.support in score) score[s.support] += SUPPORT_W + (s.offer ? OFFER_W : 0);
    if (s.oppose && s.oppose in score && s.oppose !== s.support) score[s.oppose] -= OPPOSE_W;
  }
  return score;
}

/** options 按规则的顺序（推荐方案在第一个）；只有 fair 的能被选 */
export function deliberationPick(options: { proposalId: string; fair: boolean }[], stances: Stance[]): { chosen: string; score: Record<string, number> } {
  const score = supportScores(
    options.map((o) => o.proposalId),
    stances,
  );
  let best = options[0];
  for (const o of options.slice(1)) if (o.fair && score[o.proposalId] > score[best.proposalId]) best = o;
  return { chosen: best.proposalId, score };
}
