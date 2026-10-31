"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SealLogo } from "@/components/ui";
import { FirewallDiagram, VISIBILITY, VIS_COLS } from "@/components/launch/Firewall";
import { useSelfTest } from "@/components/screen/PlanPanels";
import { QrSvg } from "@/components/screen/bits";
import { hhmm } from "@/components/screen/fmt";

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="mb-4 flex items-center gap-3 text-[22px] font-black md:text-[26px]">
        <span className="font-num flex size-8 shrink-0 items-center justify-center rounded-full bg-cinnabar text-[15px] text-white">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

const card = "rounded-[var(--radius-card)] border-2 border-ink bg-card shadow-sticker dark:border-night-line dark:bg-night-2 dark:shadow-none";

export default function FirewallPage() {
  const { test, error } = useSelfTest();
  const [juUrl, setJuUrl] = useState<string | null>(null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("ju");
    if (id && /^[\w-]{1,40}$/.test(id)) setJuUrl(`${window.location.origin}/j/${id}`);
  }, []);

  return (
    <div className="min-h-dvh bg-paper text-ink dark:bg-night dark:text-cream">
      <main className="mx-auto w-full max-w-[1180px] overflow-x-clip px-4 pb-20 md:px-8">
        <header className="flex h-16 items-center gap-3">
          <SealLogo size={36} />
          <span className="text-[17px] font-black">AI 局长 · 分身谈判原理</span>
          <Link href="/" className="ml-auto text-[14px] font-bold text-ink-soft underline decoration-ink-faint underline-offset-4 dark:text-cream-faint">
            去组个局 →
          </Link>
        </header>

        <section className="pb-2 pt-6 md:pt-10">
          <h1 className="text-[34px] font-black leading-[1.15] tracking-tight md:text-[56px]">
            说不出口的话，
            <br />
            <span className="text-cinnabar">让分身替你谈。</span>
          </h1>
          <p className="mt-4 max-w-[640px] text-[16px] leading-relaxed text-ink-soft md:text-[19px] dark:text-cream-faint">
            预算、门禁、能让什么 —— 私下交给自己的 AI 分身。分身们当着所有人的面谈判，局长主持、规则拍板，
            谁守着什么底线，从谈判记录里看不出来。我们不靠“保证”，靠<b className="text-ink dark:text-cream">结构</b>和<b className="text-ink dark:text-cream">每次都跑的检验</b>。
          </p>
        </section>

        <Section n="1" title="谁知道什么：分身只知道主人，规则看得到全部但不说话">
          <div className={`${card} p-3 md:p-6`}>
            <FirewallDiagram />
          </div>
          <div className="mt-4">
            <table className="w-full border-separate border-spacing-0 text-[13px] md:text-[16px]">
              <thead>
                <tr>
                  <th className="border-b-2 border-ink py-2 pr-3 text-left font-black dark:border-night-line">谁能看到</th>
                  {VIS_COLS.map((c) => (
                    <th key={c} className="border-b-2 border-ink px-2 py-2 text-center font-bold text-ink-soft dark:border-night-line dark:text-cream-faint">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {VISIBILITY.map((r) => (
                  <tr key={r.what}>
                    <td className="border-b border-dashed border-line py-2 pr-3 font-semibold dark:border-night-line">{r.what}</td>
                    {r.cells.map((ok, i) => (
                      <td key={i} className="border-b border-dashed border-line px-2 py-2 text-center text-[18px] font-black dark:border-night-line">
                        {ok ? <span className="text-jade dark:text-[#3ecf8e]">✓</span> : <span className="text-cinnabar">✗</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[12px] text-ink-faint dark:text-cream-faint">每个分身是单独的一次大模型调用，提示里只有主人自己的授权书；别人的分身问什么，它也只能按主人的授权回答。</p>
          </div>
        </Section>

        <Section n="2" title="谈判公开，拍板靠规则：不是谁嗓门大听谁的">
          <div className="grid gap-4 md:grid-cols-3">
            <div className={`${card} p-5`}>
              <div className="text-[13px] font-black tracking-widest text-cinnabar">先过底线</div>
              <p className="mt-2 text-[16px] leading-relaxed">
                每个分身先亮出主人的底线（最多 3 条），碰底线的方案直接出局；授权书里写了“可以让”的，分身<b>必须让</b>，不讨价还价。
                <span className="text-ink-soft dark:text-cream-faint">让了步的人，局长会在后面记一笔补偿。</span>
              </p>
            </div>
            <div className={`${card} p-5`}>
              <div className="text-[13px] font-black tracking-widest text-cinnabar">三级准则</div>
              <p className="mt-2 text-[16px] leading-relaxed">
                ① 照顾到的人最多 → ② 最吃亏的那个人别太吃亏 → ③ 大家加起来最满意。
                <span className="text-ink-soft dark:text-cream-faint">一级定不下来才看下一级，全程是算法，不是大模型拍脑袋。</span>
              </p>
            </div>
            <div className={`${card} p-5`}>
              <div className="text-[13px] font-black tracking-widest text-cinnabar">只在一样公平的方案里讨论</div>
              <p className="mt-2 text-[16px] leading-relaxed">
                准则打平的几个方案，才交给分身们辩论：支持、可以让、反对，按票算分。
                <span className="text-ink-soft dark:text-cream-faint">同样的谈判记录一定得到同样的结论，任何人都能复算。</span>
              </p>
            </div>
          </div>
        </Section>

        <Section n="3" title="分身的嘴上了锁：每句话公开前都过检查">
          <div className="grid gap-4 md:grid-cols-3">
            <div className={`${card} p-5`}>
              <div className="text-[13px] font-black tracking-widest text-cinnabar">没有名字</div>
              <p className="mt-2 text-[16px] leading-relaxed">
                谈判桌上只有“分身 A、B、C”。代号按<b>发言内容</b>分配，跟是谁无关 —— 同样的话换个人说，代号也一样。
                <span className="text-ink-soft dark:text-cream-faint">提到任何成员名字的话，直接拦下。</span>
              </p>
            </div>
            <div className={`${card} p-5`}>
              <div className="text-[13px] font-black tracking-widest text-cinnabar">不说原因，不报数</div>
              <p className="mt-2 text-[16px] leading-relaxed">
                分身只能说“这家我这边不行”，不能说为什么；预算数字、“一百五”这种中文数字、私密备注原文，一律拦。
                <span className="text-ink-soft dark:text-cream-faint">能出现的数字，只有方案里本来就公开的。</span>
              </p>
            </div>
            <div className={`${card} p-5`}>
              <div className="text-[13px] font-black tracking-widest text-cinnabar">拦下也不冷场</div>
              <p className="mt-2 text-[16px] leading-relaxed">
                被拦下的话换成按立场生成的固定句子，立场照样算数。
                <span className="text-ink-soft dark:text-cream-faint">大模型说漏嘴，最多是少一句俏皮话，不会多一句秘密。</span>
              </p>
            </div>
          </div>
        </Section>

        <Section n="4" title="实时自检：把两个人的秘密对调，公开内容一个字都不能变">
          <div className="grid gap-4 md:grid-cols-[1.1fr_1fr]">
            <div className={`${card} p-5 md:p-7`}>
              <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                <div>
                  <div className="text-[14px] font-bold text-ink-soft dark:text-cream-faint">反事实检验</div>
                  <div className="font-num text-[56px] font-bold leading-none md:text-[72px]">{test ? test.runs.toLocaleString() : error ? "—" : "…"}</div>
                </div>
                <span className="pb-2 text-[18px] font-bold text-ink-soft dark:text-cream-faint">次</span>
                <span
                  className={`ml-auto rounded-xl border-2 border-ink px-4 py-1.5 text-[28px] font-black md:text-[34px] dark:border-transparent ${
                    test ? (test.leaks === 0 ? "bg-jade text-white dark:bg-[#3ecf8e] dark:text-night" : "bg-cinnabar text-white") : "bg-paper-deep text-ink-faint dark:bg-night-3"
                  }`}
                >
                  <span className="font-num">{test ? test.leaks : "?"}</span> 泄露
                </span>
              </div>
              {test && (
                <ul className="mt-5 space-y-2">
                  {test.checks.map((c) => (
                    <li key={c.name} className="flex items-center gap-3 rounded-lg bg-paper-deep px-3 py-2 text-[15px] dark:bg-night-3">
                      <span className="font-bold">{c.name}</span>
                      <span className="font-num ml-auto text-ink-soft dark:text-cream-faint">{c.runs} 次</span>
                      <span className={`font-num font-black ${c.leaks ? "text-cinnabar" : "text-jade dark:text-[#3ecf8e]"}`}>{c.leaks} 泄露</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 text-[13px] text-ink-faint dark:text-cream-faint">
                {test ? `服务器上刚跑的，${hhmm(test.at)} · 结果缓存 10 分钟` : error ? "自检接口暂时连不上，稍后自动重试" : "正在服务器上跑 200+ 组随机场景…"}
              </p>
            </div>
            <div className={`${card} p-5 md:p-7`}>
              <h3 className="text-[18px] font-black">怎么检验的</h3>
              <ol className="mt-3 space-y-3 text-[15px] leading-relaxed text-ink-soft dark:text-cream-faint">
                <li>
                  <b className="text-ink dark:text-cream">交换检验：</b>造两个公开信息一模一样的人 A、B，只有私密信息不同。生成全部公开输出，再把两人的秘密对调重来一遍 —— 两份输出必须逐字节相同（A、B 互换后）。
                </li>
                <li>
                  <b className="text-ink dark:text-cream">谈判检验：</b>把 A、B 的授权书、心情、需求整个对调，重新谈一遍 —— 公开谈判记录必须逐字相同，说话的只有局长和分身代号。
                </li>
                <li>
                  <b className="text-ink dark:text-cream">字面检验：</b>私密备注原文、预算数字、说了不来的名字、候补的名字……一个字都不许出现在任何公开输出里。
                </li>
                <li>
                  <b className="text-ink dark:text-cream">公开满意度</b>只由通勤和时段算出 —— 超预算永远不会让一个人在公开视图里“来不了”，看满意度反推不出谁预算紧。
                </li>
              </ol>
            </div>
          </div>
        </Section>

        <Section n="5" title="攒批重算：连「什么时候变了」都不泄露">
          <div className={`${card} p-5 md:p-7`}>
            <div className="grid items-center gap-5 md:grid-cols-[1fr_auto_1fr]">
              <div className="rounded-xl border-2 border-dashed border-cinnabar p-4">
                <div className="text-[13px] font-black tracking-widest text-cinnabar">如果立即重算</div>
                <p className="mt-2 text-[16px] leading-relaxed">
                  🐰 小林刚进来 → 方案马上变便宜了
                  <br />
                  <span className="text-ink-soft dark:text-cream-faint">= 等于告诉全群：小林预算紧。</span>
                </p>
              </div>
              <span className="text-center text-[28px] font-black text-ink-faint">→</span>
              <div className="rounded-xl border-2 border-jade p-4 dark:border-[#3ecf8e]">
                <div className="text-[13px] font-black tracking-widest text-jade dark:text-[#3ecf8e]">局长的做法</div>
                <p className="mt-2 text-[16px] leading-relaxed">
                  攒够 2 个变化、隔 3 分钟以上，或者到截止时间，才重算一次。
                  <br />
                  <span className="text-ink-soft dark:text-cream-faint">思考流只说：“有 2 位朋友更新了情况”。</span>
                </p>
              </div>
            </div>
          </div>
        </Section>

        <Section n="6" title="可否认的排座：座位用了你的秘密，但从座位推不出来">
          <div className="grid gap-4 md:grid-cols-3">
            <div className={`${card} p-5`}>
              <div className="text-[13px] font-black tracking-widest text-cinnabar">双方取高</div>
              <p className="mt-2 text-[16px] leading-relaxed">
                熟不熟按两边说的<b>较大值</b>算。你觉得和 TA 挺熟、TA 觉得一般——这种最尴尬的单向关系，永远体现不出来：
                <span className="text-ink-soft dark:text-cream-faint">只要对方说了熟，你标什么，座位都一模一样。</span>
              </p>
            </div>
            <div className={`${card} p-5`}>
              <div className="text-[13px] font-black tracking-widest text-cinnabar">诱饵分组</div>
              <p className="mt-2 text-[16px] leading-relaxed">
                悄悄说“别和 TA 一桌”，局长会照办，同时用每局自己的密钥再随机分开几对别的朋友，保证从没同桌的对数 ≥ 3 × 要求数。
                <span className="text-ink-soft dark:text-cream-faint">任何一对没同过桌的人，是“有人提了要求”的比例不超过 1/3。</span>
              </p>
            </div>
            <div className={`${card} p-5`}>
              <div className="text-[13px] font-black tracking-widest text-cinnabar">藏不住就不执行</div>
              <p className="mt-2 text-[16px] leading-relaxed">
                只有一桌、或者掩护不够时，局长干脆不照办——结果和“没人提要求”<b>逐字节相同</b>，连审计里的计算次数都一样。
                <span className="text-ink-soft dark:text-cream-faint">宁可不照顾，也不让你暴露。</span>
              </p>
            </div>
          </div>
          <p className="mt-3 text-[13px] text-ink-faint dark:text-cream-faint">
            这三条都在上面的实时自检里：单向标记隐藏、单方面不可见、可否认回避。排座同样可以一键复算：同样的输入 + 同一个密钥，一定得到同样的座位。
          </p>
        </Section>

        <Section n="7" title="评委可以试试">
          <div className="grid items-center gap-5 rounded-[var(--radius-card)] border-2 border-ink bg-mustard p-5 text-ink shadow-sticker md:grid-cols-[1fr_auto] md:p-8 dark:border-mustard">
            <div>
              <p className="text-[24px] font-black leading-snug md:text-[34px]">扫码进局，私下问局长：</p>
              <p className="mt-2 text-[30px] font-black leading-snug text-cinnabar-deep md:text-[44px]">“谁预算最紧？”</p>
              <p className="mt-4 max-w-[560px] text-[15px] leading-relaxed text-ink-soft md:text-[17px]">
                局长知道答案 —— 但它只会告诉你“有人预算偏紧，已经按大家都舒服的价位筛过了”。连发起人问，也是这句。
                再去看谈判直播，猜猜分身 B 是谁。
              </p>
            </div>
            {juUrl ? (
              <div className="mx-auto w-[200px] rounded-2xl border-2 border-ink bg-white p-4 md:w-[240px]">
                <QrSvg text={juUrl} className="aspect-square w-full" />
                <div className="mt-2 text-center text-[14px] font-black">扫码入局</div>
              </div>
            ) : (
              <Link href="/" className="pressable flex min-h-14 items-center justify-center rounded-[var(--radius-btn)] border-2 border-ink bg-card px-6 text-[17px] font-bold shadow-sticker">
                先组一个局 →
              </Link>
            )}
          </div>
          <p className="mt-3 text-[13px] text-ink-faint dark:text-cream-faint">提示：地址后加 ?ju=局号，这里会直接出现那个局的二维码。</p>
        </Section>
      </main>
    </div>
  );
}
