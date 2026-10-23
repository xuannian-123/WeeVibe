import type { Metadata } from "next";
import { MyJuList } from "@/components/me/MyJuList";

export const metadata: Metadata = { title: "我的局 · AI 局长" };

export default function MePage() {
  return <MyJuList />;
}
