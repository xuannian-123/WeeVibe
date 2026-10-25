# WeeVibe

项目品牌与小程序内界面统一为 **WeeVibe**；微信平台账号名称单独申请。最新命名状态与保留的兼容标识见[名称说明](docs/team/branding.md)。

面向熟人和朋友的朋友的组局小程序：创建单环节或多环节活动，让成员自行选段、接受安排并申请，由当前管理者整体审批。

客户端采用Taro＋React＋TypeScript，后端采用Next.js Node API＋PostgreSQL/Prisma，使用共享Zod契约和pnpm单仓库。比赛演示计划使用原账号微信小程序体验版，管理与参与共用客户端。

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

## 当前实现

- 小程序：首页、创建预览与确认、详情、选段报名、整体批准/拒绝；三页轻量整理，选填项收进更多设置。
- 后端：服务端微信身份、摘要会话、本人记录、多环节创建/申请/整体审批、版本/权限/容量/幂等保护。
- 云身份入口：专用普通云函数到Next.js的签名验证、一次性凭证事务和客户端显式适配；默认关闭，不依赖原AppSecret。见[接入与验收说明](cloudfunctions/weevibeLogin/README.md)。
- 高德：服务端搜索、附近及步行接口和共享客户端；创建页搜索选点、地址回填及地图入口已接，实际开发工具两段选点至创建预览通过。
- AI：结构化契约及规则校验；真实DeepSeek Flash创建草稿、建议预览及确认填表已接通演示API，实际开发工具流程通过；新增流程手机试用与发布后协调应用待完成。见[接入说明](docs/team/ai-map-creation.md)。

当前已通过206项离线测试、类型检查与小程序构建。Linux上的真实临时PG、重启、容器和SCF打包已有独立检查。Neon Free PostgreSQL与现有CloudBase中的HTTP云函数已接通，继续运行同一Next.js API；正式微信开发工具的真实云身份与业务调用已通过，上一临时预览的单手机打开及登录由用户确认。同机双微信的创建、两段申请、整体批准及关闭重开已由用户反馈和真实PG核对通过；本轮不要求双手机，冷启动及其余业务功能分别验收，详见[当前架构与证据](docs/team/architecture.md)。[CI](https://github.com/xuannian-123/WeeVibe/actions)中的身份仍为fixture，不混记为真实微信结果。

## 规则与协作

每场唯一主环节，逐段人数/截止/接受版本；申请不占位，批准整体占位。管理者不自动参加，人数达到最低不自动成局。实质变更保位待重新接受，交接由指定接任人接受后生效。AI保留地点，展示差异、影响人与未知项，经过确认和服务端检查后才应用。

五名成员按[12张功能任务](https://github.com/xuannian-123/WeeVibe/issues)自主认领，不固定个人岗位。详见[团队入口](docs/team/README.md)、[业务规则](docs/11-首版成局加入与补位规则.md)、[当前架构与证据](docs/team/architecture.md)、[接口交接](docs/engineering/07-第二轮业务接口交接.md)及[页面交接](docs/product/05-第二轮小程序页面实施交接.md)。

首次基线之后按功能分支与PR复核；共享契约、迁移及锁文件修改前先协调。源码上传不等于小程序上传或正式发布。付费、账号改名、提审和正式发布需明确授权。
