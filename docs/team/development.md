# 克隆与本地开发

Node24（至少24.11且小于25）、pnpm11.15.1，具体依赖以锁文件为准。PostgreSQL推荐17，已有真实本机验证为17.11；可使用已有专用PG或自行准备本地实例。不要连接原业务数据库。

## 不依赖外部账号的检查

```text
git clone https://github.com/xuannian-123/weego.git
cd weego
npm install --global pnpm@11.15.1
pnpm install --frozen-lockfile
npm ci --prefix cloudfunctions/weegoLogin --ignore-scripts --no-audit --no-fund
pnpm db:generate
pnpm db:validate
pnpm typecheck
pnpm test
pnpm build:api
pnpm build:mini
```

typecheck会先执行Next typegen，生成新克隆缺少的.next路由类型，无需提交生成文件。db:generate和db:validate仅离线检查/生成，不连接数据库；pnpm test默认仅跑离线用例。

## 配置正式后端

在apps/web/.env.local中填写[环境示例](../../.env.example)的服务端项，已有文件保留。此文件被Git忽略，不能提交或在聊天粘贴。

| 变量 | 用途 |
|---|---|
| DATABASE_URL | 独立WeeVibe PG，开发与验收分库 |
| WECHAT_APP_ID | 与原账号项目配置一致的公开AppID |
| WECHAT_APP_SECRET | 普通code交换方式需要；仅服务端，不擅自重置原密钥 |
| WEEGO_CLOUD_AUTH_* | 可选云身份适配，默认关闭；API只配置公钥，函数私钥不注入API或小程序 |
| AMAP_WEB_SERVICE_KEY | 可选地图查询密钥，缺少时地点可手填 |

Next从apps/web读取.env.local；Prisma CLI需进程中同一正确DATABASE_URL，不能假设复制根.env.local就会同时配置二者。先核对目标专用库，再执行pnpm db:migrate；这是真实DDL写入，不是离线检查。

随后pnpm dev:api监听127.0.0.1:43188。/api/v1/health只证明进程存活，/api/v1/ready检查PG，不证明微信身份。普通code交换缺Secret、云身份入口缺签名配置或业务缺数据库时应明确失败，不用样例冒充成功。可选云登录的独立安装、配置和部署条件见[云身份接入说明](../../cloudfunctions/weegoLogin/README.md)。

## 小程序构建与开发工具

pnpm build:mini后在微信开发者工具导入apps/miniprogram。project.config.json使用原账号公开AppID、保持urlCheck=true；成员需具备实际开发/体验资格。微信平台资格、WeeVibe业务身份和当前活动管理权是三层不同检查。

TARO_APP_API_BASE_URL是小程序构建时公开HTTPS地址，需在构建进程设置；它不会从后端.env.local自动注入。不要把AppSecret、PG或高德密钥交给客户端。未配置API时编译仍可通过，页面会显示未配置；手机上的localhost不能指向开发者电脑。

当前演示显式选择云登录与原生云HTTP传输，在运行`pnpm build:mini`的进程设置以下公开变量；不能只配置API地址就认为登录也已切换：

| 变量 | 当前演示配置 |
|---|---|
| TARO_APP_LOGIN_MODE | cloud |
| TARO_APP_API_TRANSPORT | cloud-http |
| TARO_APP_CLOUD_ENV_ID | 经核对的现有环境ID，由项目维护者提供 |
| TARO_APP_CLOUD_LOGIN_FUNCTION | weegoLogin20261025，独立普通登录函数 |
| TARO_APP_CLOUD_API_FUNCTION | weego-api-demo，运行Next API的HTTP函数 |
| TARO_APP_API_BASE_URL | cloud-http模式可空；https模式需合法HTTPS地址 |

源码默认仍为code＋https，构建配置与后端环境变量分别管理；模式失败不会自动回退。云HTTP需原生`wx.cloud.callHTTPFunction`能力，已在正式开发工具3.16.2验证，仍须在目标手机验证。见[部署说明](./deployment.md)。

若本地dist更新后出现白屏，且开发工具实际加载的页面chunk/module与磁盘不符，可先仅清理该项目的编译缓存再普通编译。此问题曾在本次正式工程验证中出现；不需要修改微信安装目录、清理全部账号缓存或关闭urlCheck。

小程序入口在加载共享schema前配置Zod的`jitless`模式，避免微信不支持的动态代码生成；服务端仍用原配置。不要把这项初始化移到schema已经创建之后。见[Zod官方说明](https://zod.dev/compile#content-security-policy)。

## 页面更新方式

首页和创建页只在进入、返回前台或手动操作后读取，不做固定间隔轮询。活动详情每20秒静默同步，后台请求不切换整页加载状态，不清空输入或周期性禁用报名/审批；读取失败仍明确提示内容可能过时，暂停写入。隐藏或离开详情即停同步，会话失效后停自动重试，等待用户登录。连接检查页只在进入和手动检测时请求。

## 显式真实PG集成

准备两个隔离库：日常开发库与名称以weego_acceptance_开头的本机验收库。脚本拒绝其他库名及远程目标。对验收库应用全部迁移，并用同一验收URL启动API；脚本通过真实HTTP和PG操作检查，播种的用户/会话都是fixture。

```text
# 在专用终端安全设置DATABASE_URL和WEEGO_CHECK_API_BASE_URL后：
pnpm db:migrate
pnpm check:postgres:prepare
# 正常停止API/PG，重启同一PG，再以同一验收库重启API：
pnpm check:postgres:verify
```

verify核对PG启动时间实际改变及记录保持一致。脚本只在验收库建立本次随机命名的故障注入触发器，finally移除；不清空已有库。阶段结果在忽略的.working中，不含会话或连接凭据。不要把fixture结果记成真实wx.login通过。

已有Docker时也可自行准备隔离PG；仓库不包含某台电脑的下载包、数据目录和私密启动脚本。CI在标准Linux runner上使用临时PG运行相同检查，不访问原账号或商业供应商。

## 容器构建

从仓库根运行docker build -f apps/web/Dockerfile -t weego-api:local .。镜像在Linux重新构建standalone，不复制Windows产物；运行时注入服务端配置，镜像不自动迁移数据库。默认3000端口，健康探测不证明业务就绪。当前HTTP云函数承载同一standalone，按各任务完成标准验收后关闭相应Issue；本轮不要求双手机。
