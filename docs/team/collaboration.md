# 功能认领、代码分区与界面一致性方案

2026-10-25。此页区分已完成的第一批前后端分区与后续建议，不固定五人的个人岗位。代码拆分不增加业务功能，也不代表12张任务已全部完成。

## 预览 合并与共享更新的责任

成员在自己的功能分支开发、自测、预览并提交PR。维护者xuannian-123或其明确授权的集成流程负责最终复核合并、共享版本更新及整卡验收；成员的Codex默认不直接推送main、不自行合并PR、不自动关闭整卡，也不为测试自行覆盖共享云函数或直接修改共享数据库结构。

本地看到效果、代码合入main、后端部署、生成新临时预览、替换体验版和正式发布分别处理，合并不会自动更新云端API或旧二维码。页面可以先连接已部署接口；涉及新后端能力时用对应开发后端验证。连接共享API的业务操作仍可能产生共享数据，测试按团队约定标识。共享环境变量、云函数、数据库迁移、体验版及发布由维护者按具体授权统一操作。

根目录[AGENTS.md](../../AGENTS.md)提供编程代理的入口指令。成员拉取最新代码后，从仓库目录启动Codex；已有对话应明确要求重新读取。指令不等于GitHub或云平台的权限限制，硬性限制须另外配置分支保护与服务权限，本次不更改这些权限设置。

## 功能负责人推进什么

Issue按用户功能组织，代码按层和功能模块组织。WG-02～WG-10大多涉及前端、服务端规则或接口，但不要求每项都改所有层，也不要求认领者独自完成全栈。牵头人可以邀请协助，负责把该功能接通、验证并交接。

WG-01侧重工程/身份/部署，WG-11侧重联调与验收，WG-12侧重整体体验、试用与改进。界面一致性在每张功能卡开发时维持，WG-12继续做整体打磨。

## 已存在的分层

| 位置 | 当前职责 |
|---|---|
| apps/miniprogram/src/pages | 首页、创建、详情等页面入口和页面级组合 |
| apps/miniprogram/src/components | 共享UI；旧创建组件保留兼容导出 |
| apps/miniprogram/src/features | 已提取创建、详情组合、报名审批和邀请模块 |
| apps/miniprogram/src/app.css | 当前公共视觉样式 |
| apps/miniprogram/src/platform | 网络、身份、存储、生命周期、静默同步和不确定写入保护 |
| apps/web/src/app/api/v1 | HTTP路由，解析请求并进入服务端用例 |
| apps/web/src/server | 身份、活动规则/事务、AI校验和供应商适配 |
| packages/contracts | 前后端共用的Zod数据与校验契约 |
| packages/api-client | 前端调用接口的统一客户端 |
| prisma | 共享数据模型和顺序迁移 |

创建和详情路由已改为薄入口，实际逻辑分别在features/activity-create和features/activity-detail；报名/审批独立到features/applications，分享入口到features/invitations。旧组件、表单和CSS入口保留兼容。公共UI仍主要在components/ui.tsx。

活动后端已按现有用例拆分，仍属于同一Next服务和PG库；路由可继续通过service.ts的兼容导出调用。当前实际文件如下：

| 活动后端文件 | 当前职责与协作边界 |
|---|---|
| [service.ts](../../apps/web/src/server/activities/service.ts) | 汇总导出原有服务函数，保持调用路径兼容；不放新的功能实现 |
| [create.ts](../../apps/web/src/server/activities/create.ts) | WG-02现有创建用例 |
| [applications.ts](../../apps/web/src/server/activities/applications.ts) | WG-03现有申请和审批用例 |
| [snapshot.ts](../../apps/web/src/server/activities/snapshot.ts) | 活动读取与按当前身份生成可见数据；涉及多个功能时共同协调 |
| [state.ts](../../apps/web/src/server/activities/state.ts) | 共用Tx类型、活动加载与父活动锁 |
| [mutation.ts](../../apps/web/src/server/activities/mutation.ts) | 统一Serializable事务及最多3次整笔尝试（含首次），不在失败事务内继续写入 |
| [idempotency.ts](../../apps/web/src/server/activities/idempotency.ts) | 共用重放检查与操作键写入 |
| [rules.ts](../../apps/web/src/server/activities/rules.ts)、[transaction-errors.ts](../../apps/web/src/server/activities/transaction-errors.ts)、[transport.ts](../../apps/web/src/server/activities/transport.ts) | 保留原有规则、可重试错误识别和HTTP处理能力 |

## 建议逐步提取的功能边界

前端activity-create、activity-detail、applications、invitations与上表列出的后端文件已提取；下表其它功能目录仍是建议目标。已有代码边用边拆，不为每张卡预建空目录或空业务模块。

| 任务 | 前端功能模块建议 | 后端用例归属建议 |
|---|---|---|
| WG-02 创建/地点填写 | features/activity-create，复用当前editor与activity-editor | 已有[create.ts](../../apps/web/src/server/activities/create.ts)；地点查询复用providers/amap |
| WG-03 邀请/申请/审批/名单 | features/applications、features/invitations | 已有[applications.ts](../../apps/web/src/server/activities/applications.ts)；邀请归因和名单未实现部分另按明确后的规则补用例 |
| WG-04 成局/退出/补位 | features/formation、features/participation | server/activities/formation、participation |
| WG-05 安排变更/重新接受 | features/arrangement-change | server/activities/arrangement-change |
| WG-06 管理交接 | features/handover | server/activities/handover |
| WG-07 AI | features/ai，具体入口待团队收敛 | server/ai，供应商接入归providers |
| WG-08 分享卡 | features/share-card | 仅在确需服务端生成/二维码时补对应接口 |
| WG-09 待办 | features/todos | server/todos，按当前权限聚合业务状态 |
| WG-10 再约 | features/rebook，复用创建表单 | server/activities/rebook或复用创建用例，按最终规则决定 |

页面负责组合这些模块。例如详情页挂载行程、本人申请、管理审批和交接模块；各模块维护自身交互，不各造一份活动真相、登录逻辑或业务接口。

锁活动、核当前权限/版本、容量判断、幂等和完整事务仍是共享能力。各用例复用state/mutation/idempotency及原有规则，不能每个模块复制一套保护或各自提交半笔多段审批。路由、API客户端与共享契约按用例协同演进。

## 前端怎样保持一致

1. **公共组件统一**：按钮、输入、面板、提示、选择、加载/空/错误状态优先复用公共组件，新增通用组件先放公共层。当前Action的primary/secondary/text/danger等可继续扩展，避免每个模块另做按钮体系。
2. **视觉规则统一**：当前暖白绿仅为可调整的共同基线。颜色、字号、间距、圆角、主次按钮统一维护；后续可从app.css提取视觉变量/样式文件，不让不同任务自行决定全局风格。
3. **页面样式有边界**：功能样式采用各自前缀或经统一验证的局部样式方式，不在功能CSS里重定义全局.action/.panel等公共类。
4. **交互和状态一致**：申请中/已加入、待确认/已成局、未知费用/免费使用统一口径。会话恢复、输入保存、后台同步和失败重试复用platform，避免功能各写一套；首页/创建不固定轮询，详情后台同步不打断填写。
5. **统一预览复核**：功能PR除适当检查外，附相关手机/开发工具截图和操作结果；另一位成员看完整页面及前后相邻流程。CI检查类型/规则，整页视觉与易用性仍需实际查看。

团队可以修改公共设计，变更时先确认共同方向，再更新公共组件/样式和受影响页面。功能负责人有产品改进空间，跨页面公共规范由本轮共同维护。

## 共享文件与并行编辑

每轮明确一位可轮换的集成维护人，不形成固定前端/后端岗位。以下文件修改前先协调：

- 公共UI、全局样式、路由和平台登录/网络/生命周期。
- packages/contracts、packages/api-client的公共入口。
- Prisma schema/迁移、依赖/锁文件、根配置与CI。
- 活动后端state/mutation/idempotency等共享保护、snapshot的可见数据投影，以及rules/transaction-errors/transport；service.ts兼容导出的新增或调整也先通知调用方。

任务认领时在Issue说明准备改哪些文件、依赖哪些接口、需要谁协助。如果两个功能都要改详情页，先让一个人提取对应模块，约定挂载接口，再分支并行；不要让两个人分别重写整页。契约、模型和迁移通过小改动先对齐，已有迁移不原地重写。

## WG-02的具体例子

认领者可以重新思考减少填写、分步创建、模板或待定信息，先明确用户问题，再实现创建模块。纯布局可在该模块内迭代；若想让时间/地点允许待定，需同时讨论产品规则并同步契约、数据库/API和报名展示，不能只从前端删必填项。若增加通用地点选择器或日期组件，提到公共层供其他任务复用。涉及真实AI生成时与WG-07约定接入，避免各自实现一套。

提交时演示从首页发起、预览、发布到详情的连贯体验，说明真实检查与仍待验范围。满足当前任务完整条件后关闭Issue；范围调整时先修改任务说明及受影响的依赖。
