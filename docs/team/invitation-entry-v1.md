# 综合邀请／报名页 V1：第一阶段

> 本文保留第一阶段证据。2026-10-29 后续冲刺已增加动物选择预览、首屏与分享卡视觉、隔离二维码适配器和完整回归；当前交付及后端边界以 [本轮报告](invitation-sprint-20261029.md) 为准。动物仍未持久保存，真实二维码及联系方式未上线。

分支 `feat/ecold07-invitation-v1`，从 main `acc9540434ad2ad08441b186c5b4b05b56ce04de` 建立。PR41 已核实 merged；其 gathering 页面、身份门槛、动物和多人填写功能保持原样。原 AI V1 四份暂存文件保留在原 worktree，本轮使用独立 worktree。

## 第一阶段实际实现

沿用 `pages/activity/index`，不用新增路由。严格 scene 仍先由 ActivityEntry 解码、经公开邀请 GET 核验 canonical activity/source，再进入现有详情。InvitationOverview 是详情组合中的首个功能区域，位于成局、审批等管理面板之前。

复用 ActivityDetail、Itinerary、ApplicationForm、MyParticipationPanel、RosterPanel、useApplications、资料门槛和现有需求页。不复制报名 POST、幂等键、原请求恢复或授权逻辑。邀请来源展示另用现有 readSceneInvitation 公共读取与校验；必须匹配当前活动，且绑定会话、页面代次和可见性。来源不可核验时不通过该入口新增申请；只读活动信息保留。来源核验不自动登录、保存邀请或报名。

展示发起人与邀请分享者两个独立位置。当前 ActivityDetail 不提供发起人公开资料，因此如实显示“公开资料暂未提供”，不拿分享者/当前管理者冒充原发起人。人数按环节显示，不将多段占位相加假装唯一参加人数。游客、待审批、退出成员不挂载名单读取组件；当前组织者/有效加入成员继续经过原名单接口的服务端权限过滤。

正式活动昵称复用报名 `display_name`，不修改账号昵称；PR41 的头像/昵称资料门槛保留。当前正式报名不支持动物选择和私密联系方式，本页不创建相应输入或本地假保存。

## 需求／建议的真实字段映射

| 页面意向 | 当前保存方式 | 组织者实际可见范围 |
|---|---|---|
| 时间建议 | requirement response `time_preferences` | 依原权限逐人查看 |
| 地点意向 | `location_ids` 候选投票 | 汇总；`location_other` 自填原文仅本人 |
| 活动内容 | 问卷已有选项、`preference_tags` | 选项/标签汇总；未实现可送达的任意内容建议 |
| 额外说明 | `preferences` 等私人文字 | 仅本人；不能当作已给组织者留言 |

按钮只打开既有 `pages/requirements/index?activity_id=...`。未发布、404、503、冲突与畸形响应继续由现有需求页面准确反馈，不本地伪造问卷或提交。建议、需求、报名、接受和成局是独立事实。采纳建议需 WG05 正式变更及成员重新接受，第一阶段不会直接应用。

## 待后端／契约协作确认（以下均为建议接口，未实现）

1. 发起人公开投影：扩展 `packages/contracts/src/activities.ts` 和 `apps/web/src/server/activities/snapshot.ts`，明确原发起人和当前管理者的公开昵称/允许公开头像。邀请分享者仍来自 `packages/contracts/src/invitations.ts`，如需判断同一人应由服务端提供可靠关系，不能按昵称比较。
2. 活动独立身份：建议 `GET/PUT /api/v1/activities/:activityId/me/registration-profile`，保存本次昵称和 animal_id（复用 gathering 12 种 enum）。确认编辑时机、报名 display_name 同步、幂等及旧请求恢复语义后，再改 `packages/contracts/src/activities.ts`、`packages/api-client/src/index.ts`、相应用例/route；需要新持久化时再评审 `prisma/schema.prisma` 和追加迁移。不能直接复用 gathering 的“首次随机持久分配”当成手选写接口。
3. 联系方式：建议本人完整读写与当前管理者私密读取分离。PUT 输入 `{wechat?,phone?,other?}` 至少一项有效；服务端校验、明确告知用途和可见对象，并确定保留/删除规则。管理者读取建议 `GET /api/v1/activities/:activityId/registration-contacts`，每次核对数据库当前管理归属，旧管理者、分享者、成员和游客不得读取；名单、活动详情、模型输入、站内消息、scene和分享图不包含联系方式。取消/退出后的读取期限需确认。新增独立联系人模型/route/service/隐私投影与权限测试，未经确认本轮不实施。
4. 可送达的自由建议：建议独立 `POST /api/v1/activities/:activityId/suggestions`（time/place/content/extra 分类、长度约束、原请求幂等），本人查看与当前管理者查看；或明确扩展 requirement 的字段和投影。不得把应给组织者看的建议暗塞到现有“仅本人”文字中。
5. 真二维码：现有 share-card/model.ts 明确 QR_UNAVAILABLE。需要真实平台二维码 provider、与已验证 InvitationSource 绑定的 scene、权限/版本/缓存接口和真机联调。本轮不生成占位码，不把开发工具临时预览二维码当报名码。gathering ID 不冒充正式 activity ID，其入口保持 PR41 流程。

后端涉及目录实施时还须读取 apps/web/AGENTS.md。本轮没有修改上述共享契约、API客户端、Prisma或后端文件。

## 本地进入与验收

用微信开发者工具导入本 worktree 的 `apps/miniprogram`，不是原 AI worktree。正式活动普通入口：`pages/activity/index?id=<真实活动UUID>`；带来源：追加 `&invitation_id=<真实InvitationSourceUUID>`。scene 入口：`pages/activity/index?scene=<来源UUID去连字符的32位值>`，只能使用真实存在且同活动的已验证来源，不填随机值伪装成功。

先按任务运行 `pnpm.cmd --filter @weevibe/miniprogram typecheck`、`pnpm.cmd build:mini` 和对应 Vitest。普通 build 无连接配置仍可能编译成功；实际预览可显式 `pnpm.cmd build:mini:demo`，仅构建客户端，不部署后端。PR41 是否已经部署到共享 API 必须独立核实，本轮不访问业务服务验证。

建议 PR 标题：`feat: 整合综合活动邀请与报名页 V1`
验收：邀请来源合法/非法/取消/失败；游客阅读和显式登录；发起人/分享者区分；完整多段与主段；名单权限；需求入口不报名；原接受/审批/取消/满额/待重接受；双击/未知原键恢复；换账号/离页迟回；缺接口不假成功。真实微信、小屏/键盘、联系方式权限接口、动物手选持久化和真实二维码另验，不关闭整张 Issue8。
## 本轮实际验证

- 新增邀请页25项，其他scene、报名、名单、资料门槛和Screen互斥回归，共12文件334项通过；修正测试状态表的严格类型后，邀请页25项复核通过。
- `pnpm.cmd --filter @weevibe/miniprogram typecheck`：通过。
- 新增及调整测试文件的独立 TypeScript 检查：0诊断。
- `pnpm.cmd build:mini`：通过；随后显式 `build:mini:demo`：通过，供本机预览。详情chunk约285KiB，有webpack建议体积提示，不冒充平台包体或真机验收。
- `git diff --check`：通过。构建、测试和产物门禁不访问真实业务服务。
- 原AI worktree仍保留原四份暂存文件；P0-1 c56f80c是远程功能分支历史祖先。新分支未提交、推送或合并。
- 开发工具实际打开、账号资格、本版共享后端一致性、手机效果、联系人权限、动物手选和真实码：未执行／未实施，分别交接。
## 后续接口对应文件清单（仅协调提案，本轮未创建或修改）

- 发起人/当前管理者公开投影：`packages/contracts/src/activities.ts`、`apps/web/src/server/activities/snapshot.ts`；活动唯一有效参加人数如需展示，须由服务端计算 distinct，不从分段人数或昵称推算。
- 正式活动昵称/动物/本人联系方式契约：拟新增 `packages/contracts/src/activity-registration-profile.ts`，由 `packages/contracts/src/index.ts` 导出；`packages/api-client/src/index.ts` 增加相应方法。公共名单扩展还须协调 `packages/contracts/src/roster.ts`、`apps/web/src/server/activities/roster.ts`，公共投影绝不带联系方式。
- 本人资料保存：拟新增 `apps/web/src/app/api/v1/activities/[activityId]/me/registration-profile/route.ts` 及 `apps/web/src/server/activities/registration-profile.ts`。
- 当前管理者联系人读取：拟新增 `apps/web/src/app/api/v1/activities/[activityId]/registration-contacts/route.ts` 及相应最小字段服务端投影，旧管理者立即失权，公开邀请不授读取权。
- 持久化：`prisma/schema.prisma` 与全新追加 migration（名称和约束由后端负责人确认）；不改旧迁移，不在共享库试DDL。
- 可送达自由建议：拟新增 `packages/contracts/src/activity-suggestions.ts`、`apps/web/src/app/api/v1/activities/[activityId]/suggestions/route.ts`、`apps/web/src/server/activities/suggestions.ts`；必须先确定读取对象、用途告知、幂等和保留策略，不能绕用旧私人答卷。
