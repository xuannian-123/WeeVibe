# API 演示部署：HTTP 云函数与独立 PostgreSQL

更新：2026-10-25。现有CloudBase环境内已新建独立HTTP函数运行Next.js API，数据库为新建Neon Free PostgreSQL；另建普通登录函数，不依赖旧AppSecret。未开通Run、升级套餐或启用超限按量，没有覆盖旧函数、旧数据库、旧路由、体验版或线上版。此为有限演示部署，真机验收和持续运行条件尚未完成。

## 已接通与尚待验证

- Linux standalone ZIP已在真实HTTP函数运行，HTTPS及正式微信开发工具的原生`wx.cloud.callHTTPFunction`均返回health200、ready200；基础库3.16.2、urlCheck=true。
- 新库实际PG17.11、TLS证书验证通过、三条迁移已应用。API仅持独立runtime角色，限定应用表CRUD；owner保留用于迁移与备份，不注入API。
- 登录函数只持新的WeeVibe签名私钥，API只持公钥与数据库运行连接。正式开发工具实际点击两次登录均取得新会话、`/me`200，业务身份保持一致；创建→详情→首页本人记录恢复通过。用户已完成同机双微信创建、两段申请、整体批准及双方重开状态/审批区域核对，本轮不要求双手机。
- 真实Neon上的5组、21次HTTP请求通过，覆盖nonce并发、多段审批与最后席位；身份为fixture并已精确清理。离线回归192项；Linux CI另覆盖临时PG、重启、容器及SCF包检查。
- 已对独立WeeVibe库生成当前用户专用权限的custom格式备份，并恢复到全新本机隔离库：12应用表、3条迁移完整；临时库已停止。此为单次快照，不含后续写入，不代表自动备份已配置。
- 同机双微信主流程已通过；其余业务流程、云端冷启动及过期记录清理分别记录。不能把health200或CI通过当作全部可用。

## 资源与调用边界

CloudBase沿用既有套餐及共享额度，当前期限为2026-11-04，自动续费与超限按量均关闭。Neon使用独立Free项目，存在休眠和配额限制。到期或配额不足时停止并评估，不自动升级；默认测试域名也不承诺持续稳定服务。

业务请求使用原生云HTTP并携带WeeVibe Bearer。登录函数到API另经固定HTTPS和服务端签名，新增网关路径仅为`/api/v1`，路径透传开启，未覆盖旧路由。该HTTPS入口使用平台默认开发测试域名，存在功能、频率及稳定性限制，不能视为长期正式部署域名。

受限试用前还需落实函数并发/调用量控制、数据库连接预算，以及仅删除已过期CloudLoginUse/AuthSession的有界清理。当前无全局登录限流或自动清理任务，不直接扩大公开试用。开发工具来源的允许项只用于当前验证，真机通过后关闭。

## 构建产物

工作流 `Package API for SCF` 只允许手动触发，限公开仓库的标准 Ubuntu runner。使用 Node 24、pnpm 11.15.1，从干净源码安装、生成 Prisma、执行既有 `build:api`（包含 Prisma WASM 产物校验），再打包。它不加载真实环境变量、不创建测试凭据、不执行数据库迁移、不发布 Release。

`scripts/package-api-scf.mjs` 只接受 Linux 产物，保留 Next monorepo standalone 目录结构，补齐 `apps/web/.next/static` 和可选 `public`，保留经边界校验的内部相对链接及 pnpm 模块解析布局，并拒绝环境文件、私钥和本机工作目录。最终 ZIP 根目录含 `scf_bootstrap`，以 `/var/lang/node24/bin/node apps/web/server.js` 启动，监听 `0.0.0.0:9000`。ZIP 在忽略目录 `.working` 内，不应提交仓库。Actions 下载得到的外层 artifact ZIP 需先解压，再使用内层 `weevibe-api-scf.zip`。

上传步骤只保存该 ZIP，保留一天。GitHub 现行计费页将公开仓库标准 runner 的 Actions usage 列为免费，但存储限制页仍列账号 artifact 额度；触发前核对账号适用规则和当前额度，不能把公开仓库免费运行时间等同于无限存储。下载后可删除该 artifact 释放存储。

## 复现部署及后续变更

更新已含依赖的Linux standalone包时，代码更新选项须显式设为`InstallDependency=FALSE`，使用已有运行依赖。本轮控制台默认TRUE的更新在依赖阶段失败；FALSE的同一代码包更新成功。仅更新独立演示函数代码，不改运行时、端口、内存或环境变量，并以最终函数状态和实际SDK请求核验部署结果。

1. 在现有 CloudBase 环境核对独立 **HTTP 云函数** 类型和 Node 24 运行时。此路线不是 Run，也不是 `cbrf` 云托管函数框架；不因名称相似而启用收费服务。
2. 重新核对当时套餐、HTTP网关和出流量的额度及期限；不打开超限按量、不升级套餐。
3. 分别配置服务端 PostgreSQL 连接、微信身份桥接公钥和必要第三方密钥；登录函数单独持签名私钥。秘密只进入目标服务的安全配置，不能写入 ZIP、工作流或日志。WeeVibe会话随机生成，仅存摘要，不需要额外静态会话密钥。Prisma迁移由受控单次步骤执行，不能让每个函数实例启动时自动迁移。
4. 核验网关路径透传与签名固定路径一致、HTTPS、微信合法域名、默认域名限制、数据库 TLS 和连接数；新函数不覆盖原盆景业务函数和路由。
5. 依次验证 `/health`、`/ready`、真实数据库事务、桥接防重放、真机登录与完整业务闭环。构建成功只证明产物生成，不能替代云上验收。

小程序可显式配置 `TARO_APP_API_TRANSPORT=cloud-http`、固定的 `TARO_APP_CLOUD_API_FUNCTION` 和 `TARO_APP_CLOUD_ENV_ID`，通过原生 `wx.cloud.callHTTPFunction` 使用同一Next API和WeeVibe Bearer。基础库按至少3.15.2验证；能力缺失时明确失败，不自动换到HTTPS。默认仍是HTTPS，云身份函数到API的签名调用仍需验证其固定HTTPS入口。[官方调用说明](https://docs.cloudbase.net/cloud-function/function-calls/)

## 官方依据

- [CloudBase HTTP 云函数的 Next.js 示例](https://docs.cloudbase.net/cloud-function/frameworks-examples/next)
- [云函数运行时及 Node24 绝对路径](https://docs.cloudbase.net/cloud-function/runtime-support)
- [CloudBase 旧配额计算资源说明](https://cloud.tencent.com/document/product/876/120342)
- [GitHub Actions 计费](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [GitHub Actions 限制](https://docs.github.com/en/actions/reference/limits)
