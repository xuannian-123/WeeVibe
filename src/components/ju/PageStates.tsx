"use client";

import Link from "next/link";
import { Button } from "../ui";
import { Stamp } from "../Stamp";
import { TopBar } from "./JuView";

export function LoadingJu({ dark }: { dark?: boolean }) {
  return (
    <main
      className={`flex min-h-dvh flex-col items-center justify-center gap-5 ${dark ? "bg-night text-cream" : ""}`}
      aria-busy
    >
      <div className="animate-wiggle">
        <Stamp size={96} text="稍等" ring="AI 局长 · 正在赶来" />
      </div>
      <p className={`font-semibold ${dark ? "text-cream-faint" : "text-ink-soft"}`}>局长正在赶来…</p>
    </main>
  );
}

export function ErrorJu({ msg, status, onRetry }: { msg: string; status: number; onRetry: () => void }) {
  const notFound = status === 404;
  return (
    <main className="mx-auto w-full max-w-[480px] px-4">
      <TopBar />
      <section className="sticker mt-10 p-6 text-center">
        <div className="mb-3 text-5xl">{notFound ? "🕵️" : "📡"}</div>
        <h1 className="text-[22px] font-black">{notFound ? "这个局找不到了" : "网络开小差了"}</h1>
        <p className="mt-2 text-ink-soft">{notFound ? "链接可能被截断了，找发起人再要一次吧" : msg}</p>
        <div className="mt-6 flex flex-col gap-3">
          {!notFound && <Button onClick={onRetry}>再试一次</Button>}
          <Link href="/" className="flex min-h-11 items-center justify-center font-semibold text-ink-soft underline underline-offset-4">
            自己发起一个局 →
          </Link>
        </div>
      </section>
    </main>
  );
}
