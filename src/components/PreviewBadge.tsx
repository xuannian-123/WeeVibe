"use client";

// 预览版的醒目标记：只在 scripts/deploy-preview.sh 构建的版本里有（构建时打进去），线上版构建里这段直接是空的。
// 预览版和线上版的数据是分开的（预览用线上库的副本），不标出来很容易串：在线上建的局，切到预览版就找不到。
export function PreviewBadge() {
  if (process.env.NEXT_PUBLIC_JUZHANG_PREVIEW !== "1") return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(6px,env(safe-area-inset-top))] z-[90] flex justify-center px-3">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border-2 border-ink bg-mustard px-3 py-1 text-[12.5px] font-black shadow-sticker-sm">
        <span>🧪 预览版 · 数据是线上的副本</span>
        <a href="/__preview/off" className="rounded-full bg-ink px-2 py-0.5 text-[12px] text-paper">回线上版</a>
      </div>
    </div>
  );
}
