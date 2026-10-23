// Next.js 启动钩子：只在 Node 运行时启动局长的定时巡检（#11 #14 主动提醒）。
// 必须写成 if (NEXT_RUNTIME === "nodejs") { import } 的形式，edge 编译时这段才会被整段剔除
// （否则 node:crypto / node:sqlite 会被拉进 edge 包里报错）。
// startScheduler 内部挂在 globalThis 上，dev 模式 HMR 重复执行也只会有一个定时器。
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/server/after/scheduler");
    startScheduler();
  }
}
