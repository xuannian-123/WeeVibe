# WEEGO

面向熟人和朋友的朋友的组局小程序：创建单环节或多环节活动，让成员自行选段、接受安排并申请，由当前管理者整体审批。

客户端采用Taro＋React＋TypeScript，后端采用Next.js Node API＋PostgreSQL/Prisma，使用共享Zod契约和pnpm单仓库。比赛演示计划使用原账号微信小程序体验版，管理与参与共用客户端。

## 开始开发

需要Node24（≥24.11、<25）和pnpm11.15.1。

```text
pnpm install --frozen-lockfile
npm ci --prefix cloudfunctions/weegoLogin --ignore-scripts --no-audit --no-fund
pnpm db:generate
pnpm db:validate
pnpm typecheck
pnpm test
pnpm build:api
pnpm build:mini
```

完整配置、独立PG、微信开发工具和真实集成检查方法见[团队开发指南](docs/team/development.md)。后端配置位于apps/web/.env.local，小程序构建地址是独立的公开配置，凭据仅放服务端。

## 当前实现

- 小程序：首页、创建预览与确认、详情、选段报名、整体批准/拒绝；三页轻量整理，选填项收进更多设置。
- 后端：服务端微信身份、摘要会话、本人记录、多环节创建/申请/整体审批、版本/权限/容量/幂等保护。
- 云身份入口：专用普通云函数到Next.js的签名验证、一次性凭证事务和客户端显式适配；默认关闭，不依赖原AppSecret。见[接入与验收说明](cloudfunctions/weegoLogin/README.md)。
- 高德：服务端搜索、附近及步行接口和共享客户端；小程序选择器待接。
- AI：严格结构化契约及纯函数约束校验；供应商、真实模型与确认应用待接。

当前已通过174项离线测试、类型检查与小程序构建。Linux上的真实临时PG、重启、容器和SCF打包已有独立检查。Neon Free PostgreSQL与现有CloudBase中的HTTP云函数已接通，继续运行同一Next.js API；正式微信开发工具的真实云身份与业务调用已通过，上一临时预览的单手机打开及登录由用户确认。当前新界面、两微信、冷启动及完整流程分别验收，详见[当前架构与证据](docs/team/architecture.md)。[CI](https://github.com/xuannian-123/weego/actions)中的身份仍为fixture，不混记为真实微信结果。

## 规则与协作

每场唯一主环节，逐段人数/截止/接受版本；申请不占位，批准整体占位。管理者不自动参加，人数达到最低不自动成局。实质变更保位待重新接受，交接由指定接任人接受后生效。AI保留地点，展示差异、影响人与未知项，经过确认和服务端检查后才应用。

五名成员按[12张功能任务](https://github.com/xuannian-123/weego/issues)自主认领，不固定个人岗位。详见[团队入口](docs/team/README.md)、[业务规则](docs/11-首版成局加入与补位规则.md)、[当前架构与证据](docs/team/architecture.md)、[接口交接](docs/engineering/07-第二轮业务接口交接.md)及[页面交接](docs/product/05-第二轮小程序页面实施交接.md)。

首次基线之后按功能分支与PR复核；共享契约、迁移及锁文件修改前先协调。源码上传不等于小程序上传或正式发布。付费、账号改名、提审和正式发布需明确授权。
