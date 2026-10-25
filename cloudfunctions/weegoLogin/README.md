# 专用微信云身份入口

本目录是独立普通事件云函数，负责微信身份到 WeeVibe 会话的接入。业务仍在 Next.js＋PostgreSQL，不读写原盆景库、不替换旧函数、不依赖原 AppSecret。源码默认关闭；2026-10-25已在独立演示函数中显式配置，与HTTP云函数内的Next API和独立Neon PG接通。正式开发工具实际点击两次登录及`/me`200通过，业务身份一致且会话更新；同机双微信创建、两段申请、整体审批及重开一致性已有用户反馈和真实PG核对，见[实际验收](../../docs/team/two-wechat-acceptance.md)。本轮不要求双手机，持续运行条件另验。本机和CI的合成context结果仍单独记录。

## 机制与配置

小程序显式选择 cloud 登录后调用本函数。函数只解析本次 SDK `parseContext(context)`，核对 namespace、WX_APPID、WX_OPENID 和 TCB_SOURCE；忽略 event 中的所有身份、URL、密钥和凭证字段。不调用会合并全局动态环境变量的 getWXContext/getCloudbaseContext。

函数向配置的固定 HTTPS origin 下 `/api/v1/auth/cloud-wechat` POST；Ed25519 签名覆盖协议域、POST、固定路径和原始正文。证明绑定应用、环境、key_id、issuer、audience、来源、签发/到期时间及随机 nonce。有效期60秒，允许签发时间最多领先5秒；API原子消费nonce摘要、映射身份、创建会话。客户端只取得WeeVibe会话及user_id。没有签名或身份上下文时拒绝，不相信公网x-wx-*头。

配置分别参考[函数示例](./.env.example)和[API/客户端示例](../../.env.example)。这些示例不会自动载入或部署。

| 位置 | 配置 |
|---|---|
| 函数秘密配置 | 新生成的Ed25519 PKCS8 DER私钥的base64：WEEGO_CLOUD_AUTH_PRIVATE_KEY_B64；与原AppSecret无关 |
| API配置 | 对应SPKI DER公钥base64：WEEGO_CLOUD_AUTH_PUBLIC_KEY_B64；不配置函数私钥 |
| 函数与API | 同一WECHAT_APP_ID、WEEGO_CLOUD_AUTH_ENV_ID、WEEGO_CLOUD_AUTH_KEY_ID及显式WEEGO_CLOUD_AUTH_ENABLED=true |
| 函数 | WEEGO_API_BASE_URL：实际HTTPS origin，不含路径、账户、查询参数或片段；禁止跳转 |
| 小程序构建 | TARO_APP_LOGIN_MODE=cloud、TARO_APP_CLOUD_ENV_ID、TARO_APP_CLOUD_LOGIN_FUNCTION；业务可选TARO_APP_API_TRANSPORT=cloud-http与TARO_APP_CLOUD_API_FUNCTION，此时API_BASE_URL可空；默认https方式仍需TARO_APP_API_BASE_URL |

开发工具来源默认拒绝。独立验证若确需允许，函数和API须共同显式配置WEEGO_CLOUD_AUTH_ALLOW_DEVTOOLS=true，真机验收仍单独进行。客户端默认mode=code；cloud失败不会回退code，也不会由后台错误自动改变身份路线。

## 本地与CI复现

Node24，根工程按团队指南安装；本函数不属于pnpm workspace，需要独立锁定安装：

```text
npm ci --prefix cloudfunctions/weegoLogin --ignore-scripts --no-audit --no-fund
pnpm db:generate
pnpm typecheck
pnpm test
pnpm build:api
```

在已核对的本机weego_acceptance_专用PG中应用全部迁移，显式给API及检查进程同一DATABASE_URL。生成**仅测试用**配置，不输出密钥：

```text
node scripts/prepare-cloud-identity-fixture.mjs --fixture-only
# 另一个专用终端，已设置正确验收DATABASE_URL及HOSTNAME/PORT：
node --env-file=.working/cloud-identity-api.fixture.env apps/web/.next/standalone/apps/web/server.js
# 检查终端，同一验收DATABASE_URL，WEEGO_CHECK_API_BASE_URL指向本机API：
node --env-file=.working/cloud-identity-test.fixture.env --import tsx scripts/check-cloud-identity-integration.ts
```

fixture生成器在`.working`中写独立测试文件，不修改真实.env或云配置；在Windows给测试私钥文件设置当前用户专用ACL。API文件只有公钥，测试文件含临时私钥；不要上传、打印或用于部署。重新生成会改变测试密钥，运行中的测试API须使用匹配配置重启。

9组真实PG/HTTP检查覆盖：错误签名/应用/来源/过期拒绝、原身份和会话保持、实际函数模块/SDK parser→本机HTTP→PG链路、同证明并发只成功一次、不同证明同身份并发、会话插入故障全回滚，以及真实表锁等待至过期后全回滚。函数网络注入仅在测试代码把固定示例HTTPS地址映射至本机，不放宽生产HTTPS要求。fixture结果不证明真实微信context或真机已通过。

## 部署与真实验收的条件

1. 确认目标原账号/环境及独立函数名，使用函数级秘密配置；不覆盖旧函数、不修改环境共享变量或旧规则、不替换现有体验版。
2. 有实际API HTTPS入口及独立持久PG，先核对目标再迁移；容器临时目录和原文档库不能作为WeeVibe PG。
3. 核对共享额度、按量/到期行为，并落实函数调用并发、限流和监控。当前没有可依赖的全局登录限流或自动清理任务，不能将默认关闭的本地实现视作可直接公开部署。
4. 明确保留期后仅清理过期CloudLoginUse和AuthSession，不清理用户/活动；有效证明绝不能提前删除消费记录。部署前落实有界周期清理和权限，不通过手动清空表恢复登录。
5. 用新的WeeVibe签名密钥，分别安全配置函数私钥/API公钥；固定Ed25519不接受请求选择算法或密钥地址。轮换先协调两端配置与短期登录窗口，不回收旧AppSecret。
6. 仅部署普通事件函数，不增加HTTP/定时触发；选择平台实际支持且满足Node>=18.15的运行时，真实核对context字段，缺失时失败关闭。不要通过打印整个context/env诊断。
7. 用两个具体验资格的真实微信普通模式验：身份区分、同微信重登保持user_id、前后台和过期恢复、伪造/错应用/重放拒绝，以及旧盆景服务回归。业务请求需合法HTTPS，或独立验证原生云HTTP等传输；仅登录走callFunction不会使业务请求自动接通。当前已单独通过原生云HTTP的health/ready，不等同手机通过。

微信云托管与腾讯云侧云托管的身份注入能力有差别，不据“能callContainer”直接启用微信头信任。相关官方资料：[实例复用](https://docs.cloudbase.net/cloud-function/instance)、[小程序调用云函数](https://docs.cloudbase.net/recipes/add-cloud-function-wechat-miniprogram)、[云托管小程序接入](https://docs.cloudbase.net/run/develop/access/mini)。
