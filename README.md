# WeeVibe

本分支集成 v38 源码，并落实 GO／灵感／消息／我的、独立筹备与明确安排两条路径、团建分享后登录填写、分字段隐私和名单权限。详见 [集成决定与验证](docs/team/v38-integration-decisions.md)。尚未更新共享 API、数据库或小程序体验版。

**已连接既有演示配置；新增接口尚未确认部署。** 本包小程序产物已显式接入原共享云登录/云HTTP；这只是客户端接线，不是后端更新、数据库迁移或真机通过。详见[当前连接与兼容范围](docs/team/existing-demo-connection.md)。

项目品牌与小程序内界面统一为 **WeeVibe**；微信平台账号名称单独申请。最新命名状态与保留的兼容标识见[名称说明](docs/team/branding.md)。

使用Codex协作请遵循根目录[AGENTS.md](AGENTS.md)：成员在自己的分支开发、预览并提交PR，维护者统一合并及更新共享版本；本地预览、合并与部署分别处理。

面向熟人和朋友的朋友的组局小程序：创建单环节或多环节活动，让成员自行选段、接受安排并申请，由当前管理者整体审批。

客户端采用Taro＋React＋TypeScript，后端采用Next.js Node API＋PostgreSQL/Prisma，使用共享Zod契约和pnpm单仓库。比赛演示计划使用原账号微信小程序体验版，管理与参与共用客户端。

## 本次交付先看这里

本源码包在上游提交 [`0b635e9fba728a40a93ab07b6512af02cb475518`](https://github.com/xuannian-123/WeeVibe/tree/0b635e9fba728a40a93ab07b6512af02cb475518) 上继续实现；下方保留的“三页、206 项、原演示 AI/地图/微信/PG 接通”是**上游历史记录，不是本次包的配置或验收结论**。

- 当前能力、首片限制和未完成项以[晨间验收](docs/team/morning-acceptance.md)及各范围文档为准；[本次交付健康检查](docs/team/delivery-health-check.md)区分真实本地 HTTP、离线业务 fixture 与尚未验收项。
- 本 ZIP 的 dist 已使用仓库公开演示配置构建。源码普通 `build:mini` 仍默认空API；以后重建这个配置版须显式 `pnpm build:mini:demo`。新增接口不会因客户端接线而自动部署，不关闭域名校验、不假登录或把旧接口当新版后端。
- **目标共享库的新增迁移仍需核对；本分支共 12 条迁移。** 管理交接 partial unique/真实锁并发未验；新版整场取消也依赖第 10 条迁移。部署、迁移、真实微信与生产操作须另行授权。
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
