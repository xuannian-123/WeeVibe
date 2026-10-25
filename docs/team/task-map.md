# 12张任务的代码入口与修改边界

2026-10-25。按功能认领，每张任务约定一位牵头人，可找协助；不要求牵头人独立完成全栈，也不固定五人岗位。

第一批前端已提取activity-create、activity-detail、applications、invitations；后端现有创建、申请/审批、活动读取也已按用例拆分，service.ts保留兼容汇总导出。此次只调整代码归属，不增加业务功能，也不代表12张任务已经完成。下表区分现有入口与后续建议，不为未实施功能创建空文件。

直接入口：[创建流程](../../apps/miniprogram/src/features/activity-create/index.tsx)、[创建表单](../../apps/miniprogram/src/features/activity-create/activity-editor.tsx)、[详情控制器](../../apps/miniprogram/src/features/activity-detail/use-activity-detail.ts)、[报名/审批状态](../../apps/miniprogram/src/features/applications/use-applications.ts)、[报名/审批面板](../../apps/miniprogram/src/features/applications/panels.tsx)、[邀请入口](../../apps/miniprogram/src/features/invitations/index.tsx)。

后端入口：[创建用例](../../apps/web/src/server/activities/create.ts)、[申请/审批用例](../../apps/web/src/server/activities/applications.ts)、[活动读取与权限投影](../../apps/web/src/server/activities/snapshot.ts)、[兼容服务入口](../../apps/web/src/server/activities/service.ts)。

| 任务 | 前端入口/模块 | 后端与数据入口 | 协作重点 |
|---|---|---|---|
| WG-01 工程/身份 | platform、app入口、diagnostics | server/auth、db、登录云函数及部署配置 | 公共能力，修改前协调受影响任务 |
| WG-02 创建/地点 | features/activity-create，pages/editor挂载 | [创建route](../../apps/web/src/app/api/v1/activities/route.ts)、[create.ts](../../apps/web/src/server/activities/create.ts)；地点查询复用providers/amap | 纯创建体验在模块内改；契约/地点待定等规则变化跨端对齐 |
| WG-03 邀请/报名/审批/名单 | features/applications、features/invitations，详情挂载 | applications/decision routes、[applications.ts](../../apps/web/src/server/activities/applications.ts)；可见数据由[snapshot.ts](../../apps/web/src/server/activities/snapshot.ts)投影 | 复用当前权限/整体事务；名单与邀请归因仍有未实现项 |
| WG-04 成局/退出/补位 | 后续formation、participation模块 | 后续活动用例，复用共享规则/事务 | 新增前先明确接口与详情挂载点，不复制整页 |
| WG-05 变更/重接受 | 后续arrangement-change，复用可用表单组件 | 后续活动变更/接受用例、版本和席位记录 | 与创建/参加/成局约定影响范围，共享模型先协调 |
| WG-06 管理交接 | 后续handover模块，详情挂载 | 后续交接用例和当前管理归属 | 与权限、取消/参加状态协调，原子切换 |
| WG-07 AI | 后续ai模块，入口待团队收敛 | server/ai、providers、contracts/ai | 密钥仅服务端；确认应用与活动事务共同设计 |
| WG-08 分享卡 | 后续share-card，复用行程展示数据 | 仅确需服务端二维码/生成时增加相应接口 | 与邀请路径/权限边界统一 |
| WG-09 待办 | 后续todos，首页挂载 | 后续有权限的聚合查询 | 与各状态产生方约定契约，不各造业务状态 |
| WG-10 再约 | 后续rebook，复用activity-create | 后续草稿生成/现有创建流程 | 新日期、同意、成员及核实状态不盲目复制 |
| WG-11 联调/验收 | tests、两微信实际试用、证据记录 | 复用隔离验收脚本及正式API | 按真实结果验，不把fixture当实际微信 |
| WG-12 整体体验 | 页面组合、公共UI及实际试用问题 | 有功能变化时同步相应后端任务 | 每个功能开发时保持统一，继续做整体验收 |

## 共享文件先协调

- 公共UI/app.css、app路由、platform登录/网络/生命周期。
- packages/contracts与packages/api-client公共入口。
- prisma/schema.prisma及迁移；根依赖、锁文件和CI。
- 活动后端公共区：[state.ts](../../apps/web/src/server/activities/state.ts)共用事务类型、活动加载和父活动锁；[mutation.ts](../../apps/web/src/server/activities/mutation.ts)统一Serializable事务与最多3次整笔尝试（含首次）；[idempotency.ts](../../apps/web/src/server/activities/idempotency.ts)统一重放检查和写键。
- [snapshot.ts](../../apps/web/src/server/activities/snapshot.ts)的活动读取/权限投影，以及原有[rules.ts](../../apps/web/src/server/activities/rules.ts)、[transaction-errors.ts](../../apps/web/src/server/activities/transaction-errors.ts)、[transport.ts](../../apps/web/src/server/activities/transport.ts)仍须跨任务协调；[service.ts](../../apps/web/src/server/activities/service.ts)只保留兼容汇总导出，不再堆入各功能实现。

同一文件同一时间明确主要编辑者。先在Issue写计划修改模块、共享接口与协助需求；共享改动用小PR先对齐，再各自分支开发。主对话当前负责第一批集成，真人接手后团队自行约定可轮换维护人。

页面壳只组合模块；改功能优先在模块内完成，需要新增详情挂载点时统一合入。前端规范见[共享界面与交互规范](./frontend-guide.md)，完整协作原则见[代码分区方案](./collaboration.md)。
