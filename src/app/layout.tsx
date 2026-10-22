import type { Metadata, Viewport } from "next";
import "@fontsource-variable/space-grotesk";
import "./globals.css";
import { Toaster } from "@/components/toast";

export const metadata: Metadata = {
  title: "AI 局长 · 一句话，局就组好了",
  description: "说一句话，AI 局长帮你约时间、挑公平的店、投票、盖章定局。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#fbf5ec",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
