// 规则版公开文案（#8 群公告、群消息兜底）。只吃 PublicFacts —— 跟公开 LLM 一样，类型上拿不到私密信息。
// 公告里不点名：今天在局里的人明天可能退出，历史公告里留着他的名字就等于告诉大家"他后来不来了"。
import type { GroupMessages, PublicFacts } from "../types";

const head = (f: PublicFacts) => `【${f.title}】`;

function proposalLines(f: PublicFacts): string[] {
  return (f.proposals ?? []).map((p) => {
    // 标题里已经写了人均就不再重复
    const cost = p.costPerPerson !== undefined && !/人均/.test(p.headline) ? ` 人均${Math.round(p.costPerPerson)}` : "";
    return `· ${p.labelText}${p.recommended ? "（局长推荐）" : ""}：${p.slotLabel} ${p.poiName}${cost}，${p.headline}`;
  });
}

export function createdText(f: PublicFacts): string {
  return `📣${head(f)}${f.organizerName ?? "有人"}在组局！点链接确认偏好卡片就能报名～预算、时间、来不来，都只告诉局长，群里不会知道是谁说的。`;
}

export function quorumMetText(f: PublicFacts): string {
  return `🎉${head(f)}凑齐了！已经有 ${f.counts.quorumHave ?? f.counts.in} 位朋友私下说了"来"，局正式成立。还没回的朋友点链接跟局长说一声～`;
}

export function planText(f: PublicFacts, replan = false): string {
  const lines = [
    replan ? `🔄${head(f)}有朋友更新了情况，局长重新排了一遍方案：` : `🗳${head(f)}局长出方案了：`,
    ...proposalLines(f),
  ];
  if (f.why?.length) lines.push(`局长推荐第一个：${f.why.join("；")}`);
  else if (f.recommendation) lines.push(`局长的理由：${f.recommendation}`);
  if (f.constraintSummaries.length) lines.push(`已考虑：${f.constraintSummaries.join("；")}`);
  lines.push("点链接投票，过半就定～");
  return lines.join("\n");
}

export function confirmedText(f: PublicFacts): string {
  const c = f.confirmed;
  if (!c) return `✅${head(f)}定了！点链接看详情。`;
  return [
    `✅${head(f)}定了！`,
    `🕖 ${c.slotLabel}`,
    `📍 ${c.poiName}${c.address ? `（${c.address}）` : ""}`,
    `👥 ${c.headcount} 人`,
    ...(c.why?.length ? [`为什么：${c.why.join("；")}`] : []),
    ...(c.risks?.length ? ["注意：", ...c.risks.map((r) => `· ${r.text} → ${r.mitigation}`)] : []),
    ...(c.fallback ? [`备案：如果${c.fallback.trigger}，改去「${c.fallback.poiName}」`] : []),
    "每个人的出发时间和路线，局长已经私信给你了，点链接还能加日历。",
  ].join("\n");
}

/** 当前阶段的一句群公告 */
export function ruleBroadcast(f: PublicFacts): string {
  switch (f.status) {
    case "collecting": {
      if (f.counts.quorumNeed !== undefined && (f.counts.quorumHave ?? 0) < f.counts.quorumNeed) {
        const left = f.counts.quorumNeed - (f.counts.quorumHave ?? 0);
        return `📣${head(f)}还差 ${left} 位朋友就成局了！点链接确认偏好，来不来都只告诉局长。`;
      }
      return `📣${head(f)}已经 ${f.counts.done}/${f.counts.in} 位朋友确认偏好了，其他朋友点链接确认卡片就好～`;
    }
    case "voting":
      return planText(f);
    case "confirmed":
      return confirmedText(f);
    case "cancelled":
      return `${head(f)}这次时间不太凑巧，下次再约～`;
  }
}

export function ruleGroupMessages(f: PublicFacts): GroupMessages {
  const out: GroupMessages = {
    broadcast: ruleBroadcast(f),
    nudges:
      f.status === "collecting" || f.status === "voting"
        ? f.members
            .filter((m) => m.intake !== "done")
            .map((m) => ({ memberId: m.id, name: m.name, text: `@${m.name} 记得确认偏好卡片，局长来替大家安排～` }))
        : [],
  };
  const c = f.confirmed;
  if (c) {
    out.reservationScript = `您好，想订 ${c.slotLabel}，${c.headcount} 位，${f.category}。麻烦帮忙留个位置，谢谢！`;
    out.reservationDialog = [
      { who: "局长", text: `您好，请问是${c.poiName}吗？想订个位。` },
      { who: "店员", text: "您好，请问几位、什么时间？" },
      { who: "局长", text: `${c.slotLabel}，${c.headcount} 位。` },
      { who: "店员", text: "好的，给您留好了，到店报手机尾号就行。" },
      { who: "局长", text: "好的，谢谢！" },
    ];
  }
  return out;
}
