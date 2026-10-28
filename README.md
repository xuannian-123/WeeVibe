# WeeVibe

四导航的滚动与浏览恢复、统一图标、文字留白、卡片、操作反馈及弹层适配已完成本轮精修，见[界面精修记录](docs/team/ui-polish-20261027.md)。城市识别继续使用大致位置；精确接口获批后，“查看附近”接入独立精确授权，并保留主动选择大致位置搜索，见[精确定位接入](docs/team/precise-location-integration-20261028.md)。

四个本地设计对话的导航方案已整合为真实页面，并保留 PR31 自动登录修复。新增消息投影、已读状态及受同活动权限保护的成员主页；实现范围与分层验证见[四导航集成说明](docs/team/navigation-integration-20261027.md)。

本分支集成 v38 源码，并落实 GO／灵感／消息／我的、独立筹备与明确安排两条路径、团建分享后登录填写、分字段隐私和名单权限。详见 [集成决定与验证](docs/team/v38-integration-decisions.md)。已合入 main 并部署独立演示 API，演示库已应用全部 12 条迁移。小程序临时预览也已更新并生成新二维码；体验版及正式版未替换。

**2026-10-27 已更新演示后端。** Linux 包、数据库备份恢复及升级、实际微信云登录与新增只读接口均已核验，见[部署记录](docs/team/v38-deployment-20261027.md)。新版客户端已通过开发工具入口检查并生成临时预览二维码；请使用新二维码打开。新版完整业务与手机体验仍须分别验收。

项目品牌与小程序内界面统一为 **WeeVibe**；微信平台账号名称单独申请。最新命名状态与保留的兼容标识见[名称说明](docs/team/branding.md)。

使用Codex协作请遵循根目录[AGENTS.md](AGENTS.md)：成员在自己的分支开发、预览并提交PR，维护者统一合并及更新共享版本；本地预览、合并与部署分别处理。

面向熟人和朋友的朋友的组局小程序：创建单环节或多环节活动，让成员自行选段、接受安排并申请，由当前管理者整体审批。

客户端采用Taro＋React＋TypeScript，后端采用Next.js Node API＋PostgreSQL/Prisma，使用共享Zod契约和pnpm单仓库。比赛演示计划使用原账号微信小程序体验版，管理与参与共用客户端。

## 本次交付先看这里

本源码包在上游提交 [`0b635e9fba728a40a93ab07b6512af02cb475518`](https://github.com/xuannian-123/WeeVibe/tree/0b635e9fba728a40a93ab07b6512af02cb475518) 上继续实现；下方保留的“三页、206 项、原演示 AI/地图/微信/PG 接通”是**上游历史记录，不是本次包的配置或验收结论**。

- 当前能力、首片限制和未完成项以[晨间验收](docs/team/morning-acceptance.md)及各范围文档为准；[本次交付健康检查](docs/team/delivery-health-check.md)区分真实本地 HTTP、离线业务 fixture 与尚未验收项。
- 本 ZIP 的 dist 已使用仓库公开演示配置构建。源码普通 `build:mini` 仍默认空API；以后重建这个配置版须显式 `pnpm build:mini:demo`。新增接口不会因客户端接线而自动部署，不关闭域名校验、不假登录或把旧接口当新版后端。
- **目标演示库已应用全部 12 条迁移。** 管理交接唯一 pending 索引与关键约束已核验；管理交接真实多人竞争及新版完整微信业务链路仍未验。本轮授权只完成独立演示后端，小程序发布和后续共享更新继续分别授权。
- [管理交接首片](docs/team/management-handover.md)、[成局首片](docs/team/formation-slice-a.md)、[本人版本审阅 B1](docs/team/arrangement-reaccept-b1.md)与[协调 C1](docs/team/coordination-preparation-c1.md)不等于整张 Issue 或全部核心流程完成。源码回退不等于数据库回滚或撤销已发请求。

## 开始开发

需要Node24（≥24.11、<25）和pnpm11.15.1。

```text
pnpm install --frozen-lockfile
npm ci --prefix cloudfunctions/weevibeLogin --ignore-scripts --no-audit --no-fund
pnpm db:generate
pnpm db:validate
pnpm typecheck
pnpm test
pnpm build:api
pnpm build:mini
```

完整配置、独立PG、微信开发工具和真实集成检查方法见[团队开发指南](docs/team/development.md)。后端配置位于apps/web/.env.local，小程序构建地址是独立的公开配置，凭据仅放服务端。

## 上游历史基线实现与验收（不代表本次交付）

- 小程序：首页、创建预览与确认、详情、选段报名、整体批准/拒绝；三页轻量整理，选填项收进更多设置。
- 后端：服务端微信身份、摘要会话、本人记录、多环节创建/申请/整体审批、版本/权限/容量/幂等保护。
- 云身份入口：专用普通云函数到Next.js的签名验证、一次性凭证事务和客户端显式适配；默认关闭，不依赖原AppSecret。见[接入与验收说明](cloudfunctions/weevibeLogin/README.md)。
- 高德：服务端搜索、附近及步行接口和共享客户端；创建页搜索选点、地址回填及地图入口已接，实际开发工具两段选点至创建预览通过。
- AI：结构化契约及规则校验；真实DeepSeek Flash创建草稿、建议预览及确认填表已接通演示API，实际开发工具流程及用户新预览试用反馈通过；发布后协调应用待完成。见[接入说明](docs/team/ai-map-creation.md)。

上游基线当时已通过206项离线测试、类型检查与小程序构建。Linux上的真实临时PG、重启、容器和SCF打包已有独立检查。Neon Free PostgreSQL与现有CloudBase中的HTTP云函数已接通，继续运行同一Next.js API；正式微信开发工具的真实云身份与业务调用已通过，上一临时预览的单手机打开及登录由用户确认。同机双微信的创建、两段申请、整体批准及关闭重开已由用户反馈和真实PG核对通过；本轮不要求双手机，冷启动及其余业务功能分别验收，详见[当前架构与证据](docs/team/architecture.md)。[CI](https://github.com/xuannian-123/WeeVibe/actions)中的身份仍为fixture，不混记为真实微信结果。

## 规则与协作

每场唯一主环节，逐段人数/截止/接受版本；申请不占位，批准整体占位。管理者不自动参加，人数达到最低不自动成局。实质变更保位待重新接受，交接由指定接任人接受后生效。AI保留地点，展示差异、影响人与未知项，经过确认和服务端检查后才应用。

五名成员按[12张功能任务](https://github.com/xuannian-123/WeeVibe/issues)自主认领，不固定个人岗位。详见[团队入口](docs/team/README.md)、[业务规则](docs/11-首版成局加入与补位规则.md)、[当前架构与证据](docs/team/architecture.md)、[接口交接](docs/engineering/07-第二轮业务接口交接.md)及[页面交接](docs/product/05-第二轮小程序页面实施交接.md)。

首次基线之后按功能分支与PR复核；共享契约、迁移及锁文件修改前先协调。源码上传不等于小程序上传或正式发布。付费、账号改名、提审和正式发布需明确授权。
