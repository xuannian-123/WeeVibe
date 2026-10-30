import type { Metadata } from "next";
import { JuPage } from "@/components/ju/JuPage";

export const metadata: Metadata = {
  title: "AI 局长 · 确认偏好，轻松入局",
  description: "预算、门禁、来不来，只有局长知道。群里只看到结论。",
};

/** 开发环境可以用 ?mock=chat|swipe|quorum|waiting|waitlist|declined|voting|confirmed|after|entry|cancelled 看假数据 */
const MOCK_OK = process.env.NODE_ENV !== "production" || process.env.ALLOW_GALLERY === "1";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const mock = MOCK_OK && typeof sp.mock === "string" ? sp.mock : undefined;
  return <JuPage id={id} mock={mock} />;
}
