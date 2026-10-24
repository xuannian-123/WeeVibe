# API 部署准备：SCF HTTP 云函数候选

此文件记录可审查的打包路线，不代表已部署、已开通收费资源或已切换原小程序服务。

## 构建产物

工作流 `Package API for SCF` 只允许手动触发，限公开仓库的标准 Ubuntu runner。使用 Node 24、pnpm 11.15.1，从干净源码安装、生成 Prisma、执行既有 `build:api`（包含 Prisma WASM 产物校验），再打包。它不加载真实环境变量、不创建测试凭据、不执行数据库迁移、不发布 Release。

`scripts/package-api-scf.mjs` 只接受 Linux 产物，保留 Next monorepo standalone 目录结构，补齐 `apps/web/.next/static` 和可选 `public`，解引用仅限产物内部的链接，并拒绝环境文件、私钥和本机工作目录。最终 ZIP 根目录含 `scf_bootstrap`，以 `/var/lang/node24/bin/node apps/web/server.js` 启动，监听 `0.0.0.0:9000`。ZIP 在忽略目录 `.working` 内，不应提交仓库。Actions 下载得到的外层 artifact ZIP 需先解压，再使用内层 `weego-api-scf.zip`。

上传步骤只保存该 ZIP，保留一天。GitHub 现行计费页将公开仓库标准 runner 的 Actions usage 列为免费，但存储限制页仍列账号 artifact 额度；触发前核对账号适用规则和当前额度，不能把公开仓库免费运行时间等同于无限存储。下载后可删除该 artifact 释放存储。

## 真正部署前必须落实

1. 在现有 CloudBase 环境确认独立 **HTTP 云函数** 类型和 Node 24 运行时可用。此路线不是 Run，也不是 `cbrf` 云托管函数框架；不因名称相似而启用收费服务。
2. 确认旧套餐额度确实覆盖该类型，以及 HTTP 网关和出流量的规则；不打开超限按量、不升级套餐。
3. 分别配置服务端 PostgreSQL 连接、会话密钥、微信身份桥接公钥和必要第三方密钥。密钥只进入目标服务的安全配置，不能写入 ZIP、工作流或日志。Prisma 迁移由受控单次步骤执行，不能让每个函数实例启动时自动迁移。
4. 核验网关路径透传与签名固定路径一致、HTTPS、微信合法域名、默认域名限制、数据库 TLS 和连接数；新函数不覆盖原盆景业务函数和路由。
5. 依次验证 `/health`、`/ready`、真实数据库事务、桥接防重放、真机登录与完整业务闭环。构建成功只证明产物生成，不能替代云上验收。

## 官方依据

- [CloudBase HTTP 云函数的 Next.js 示例](https://docs.cloudbase.net/cloud-function/frameworks-examples/next)
- [云函数运行时及 Node24 绝对路径](https://docs.cloudbase.net/cloud-function/runtime-support)
- [CloudBase 旧配额计算资源说明](https://cloud.tencent.com/document/product/876/120342)
- [GitHub Actions 计费](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [GitHub Actions 限制](https://docs.github.com/en/actions/reference/limits)
