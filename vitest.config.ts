import { configDefaults, defineConfig } from "vitest/config";

// 并行开发时智能体的工作区在 .claude/worktrees 下，不能被主仓库的测试扫进来
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, ".claude/**", ".next*/**"] },
});
