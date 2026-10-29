# Issue #8 综合邀请页冲刺交付

2026-10-29，分支 `feat/ecold07-invitation-v1`。远程 main 经 GitHub API 核对为 `acc9540434ad2ad08441b186c5b4b05b56ce04de`，本工作树以该提交为基线，保留上一轮 7 个未提交文件并继续实现。Issue #8 仍开放；本片是可审核的部分交付。未改 main、共享契约/API 客户端、Prisma 模型或迁移、全局 UI/CSS、CI、部署及共享数据。

## 已实现与真实支持范围

| 能力 | 当前结果与数据来源 |
|---|---|
| 综合邀请页 | 沿用 `pages/activity/index` 和现有控制器；首屏展示真实活动名、环节数、主环节占位、本人待审批/席位和组织者视角，已有状态时主按钮定位本人状态 |
| 行程 | 复用 Itinerary，完整展示主环节标记、时间地点、分段人数/容量、截止、参考费用与未核实/未预订；不将分段人数相加假装唯一人数 |
| 邀请来源 | 复用公开邀请 GET 核验真实来源且匹配活动；来源未核验、失败、错活动或取消时禁止经本入口新增报名，不丢失旧申请/草稿 |
| 原发起人 | ActivityDetail 未投影原发起人身份，Activity 只存当前管理者；如实显示公开资料未提供，不拿分享者或接任管理者冒充 |
| 报名与审批 | 只挂载一次原 ApplicationForm/useApplications；接受安排、容量、幂等、未知结果恢复、资料门槛及整体审批保持原实现 |
| 活动昵称 | 原申请 `display_name` 随真实申请保存；重新进入展示服务端返回的最近一条有昵称的报名记录，不修改主账号、不用本地假保存、不覆盖未提交昵称 |
| 名单与头像 | 有效加入成员/当前组织者才挂载原 RosterPanel；按原服务端权限读取报名名，现有“成员主页”可查看获准公开的账号昵称/头像，未改为默认公开动物名单 |
| 需求与建议 | 明显的 Lilac 入口复用 requirements；不报名、不改变活动。时间按原权限可见；地点投票和标签汇总可见，自填地点/私人备注不冒充已送达的自由建议；展开可见范围说明 |
| 动物形象 | 复用 PR41 的 12 张 PNG 和 GatheringAnimalId enum；主动手选、随机换一种、清除，页面隐藏/卸载/身份切换清除。明确“仅预览 · 尚未保存、不随报名提交” |
| 分享卡 | 原单模板 Canvas 升级 Cream/Lime/Ink/Lilac，主环节独立底色和圆角卡片；保留全部环节顺序、长文字换行、5000px 上限、费用口径、公开来源及快照提醒 |
| 分享生命周期 | 原取消/保存失败恢复、双击同步锁、会话/版本/来源 A→B→A、离页、迟到导出/保存保护保留。已交给原生相册的操作不能撤回 |
| 真二维码 | 仅完成未接入生产的 `registration-code.ts` 端口适配器和隔离测试；当前页面/Canvas 仍显示不可用，未请求平台、未嵌假码 |
| 私密联系方式/匿名 | 未实现、未收集。现有账号资料 schema 拒绝联系方式字段，不能安全借作按活动授权的联系人存储 |

PR41 的 gathering 动物是首次随机、按 gathering 成员保存的身份，相关写接口还受筹备角色、填写及定案锁定约束；正式 activity UUID 不能代作 gathering UUID。维护者在 PR41 记录了演示环境更新，本轮没有访问共享业务服务验证其运行状态，也未作任何部署。

源码范围：`features/activity-entry/{InvitationOverview.tsx,use-invitation-source.ts,AnimalPreview.tsx,animal-options.ts,invitation-overview.css}`；`features/activity-detail/screen.tsx` 只调整模块挂载；`features/share-card/{ActivityShareCard.tsx,canvas.ts,model.ts,registration-code.ts,share-card.css}`。新增 `tests/invitation-overview-ui.test.ts`、`tests/registration-code.test.ts`，扩展分享卡模型/交互和邀请 Screen 测试；另外 10 个旧功能 UI 测试只补齐原生图片/真实时间格式替身，既有业务断言保留。复现脚本为 `scripts/{preview-invitation.mjs,capture-invitation-preview.mjs}` 和 `scripts/fixtures/invitation-preview*.tsx`；说明为本报告与第一阶段 invitation-entry-v1.md。

## 界面与可复现排版证据

局部样式使用 #F8F6F0 / #A7F05A / #222222 / #B7A4F8 / #FF9DAB。保留 Taro designWidth=750 的 pxtransform；不改全局页面主题。主标题、来源、行程、建议入口、选段报名和本人状态分组；小屏长中文可换行，按钮胶囊和卡片圆角。

```text
node scripts/preview-invitation.mjs
node scripts/capture-invitation-preview.mjs
```

第一条输出 `outputs/invitation-preview/index.html`。浏览器打开后可选游客/参与者/组织者/长中文/分享图；数据明确标记为离线合成，所有业务 API 端口均禁用，不能用于验证真实报名。第二条使用已安装 Chrome 的隔离无头实例；可附 Chrome 可执行文件路径参数，不连接用户浏览器资料。

实际生成 `guest-375.png`、`participant-375.png`、`manager-430.png`、`long-320.png`、`card-375.png` 和 `layout-evidence.json`，位于同一 outputs 目录（不入仓的本机验证产物）。5 种布局的 scrollWidth 均等于 320/375/430 对应 viewport；动物区域 12 张 PNG 加载成功，参与者截图显示显式手选预览。分享图调用实际 cardLayout/renderActivityCard，仅用浏览器 Canvas 替代原生端口。已目视核对行程、费用、主段、二维码缺失提示和底部状态。

这些是浏览器中的真实组件/Canvas 排版截图，不是微信截图、真实活动或用户手机验收。浏览器控制插件初始化连续超时后使用本机无头 Chrome；首次普通窄窗口截图实际 viewport 有最低宽度裁切，已改为 CDP 显式移动端 viewport 后重新生成，不使用旧图作为小屏证据。

## 二维码服务端协作边界（未实施 route/provider）

现有 `features/invitations/scene.ts` 只编码公开 InvitationSource UUID 去连字符的 32 位 hex，原 ActivityEntry 仍先核验 canonical activity/source，再进入当前活动。没有 token、OpenID、私人答卷或管理权。已有 scene 解析不等于有真实微信码。

新隔离适配器依次执行公开来源读取、同活动及未取消校验、调用注入服务端生成端口、严格校验响应绑定与有界 PNG/JPEG base64。每个异步边界调用 assertCurrent，拒绝错误活动/来源/页面/环境、未知字段、远程 URL、HTML 和过大响应。测试使用真实动物 PNG 验证传输形状，明确不是可扫码图片。它不证明图片内容可扫码，服务器仍须校验 provider 成功、实际解码/尺寸、大小及格式，客户端集成前再补原生落盘/清理/嵌码测试。

建议评审接口 `POST /api/v1/activities/:activityId/registration-code`：

- 客户端只提交 `{invitation_id, env_version}`，env_version 必须显式为 trial/develop/release，不能默认为正式版；只接既有已核验 outgoing source，不把 incoming URL 当作本人可生成的来源。
- 服务端按真实登录、当前活动和既有邀请创建资格校验，来源必须真实属于目标活动且归属符合约定；生成前及返回/缓存命中前复验取消和资格。固定 page=`pages/activity/index`、scene=公开来源 32hex、width=430、check_path=true；客户端不能注入任意路径/scene/平台凭据。
- 响应：`{activity_id, invitation_id, page, scene, env_version, image:{content_type,base64}}`，严格白名单、有界；私密鉴权响应 no-store，缓存键至少包括 AppID/page/scene/env/width，限流与同键请求合并。没有邀请码即不生成，不在此接口偷偷创建来源或报名。
- 服务端 provider 可由维护者选择可信云 OpenAPI 或服务端 access_token 承载；AppSecret/access_token 永不下发。不能修改现有登录函数以绕过平台权限；需独立开发服务和维护者授权的集成部署。
- 微信官方参考：[getUnlimitedQRCode](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/qrcode-link/qr-code/getUnlimitedQRCode.html)。本轮官方页面访问失败，未把第三方样例当平台验收；实际平台参数、页面发布状态、trial/develop 支持、调用权限/额度及扫码成员资格，必须由维护者按当前官方文档与控制台核对。严格页面检查未关闭。
- 联调测试：不存在/跨活动/取消/旧管理者/未加入/游客、缺配置、provider JSON 错误伪装图片、超时/限流、缓存跨环境隔离、迟到请求、真实手机生成保存及扫码回到正确活动/来源。旧快照扫码仍读取最新取消/安排，不授席位。

当前适配器没有被 ActivityShareCard 调用；页面继续显示“报名二维码暂不可用”。没有新共享路由、合同、服务端凭据、云函数或部署。

## 活动身份与私密联系方式的准确后端需求

需团队先协调 contracts/api-client、snapshot/roster 权限投影及新模型；本轮不修改这些共享文件。

建议将活动身份与联系人拆成两个资源：

1. `GET/PUT /activities/:id/me/registration-profile`：`{nickname, animal_id, public_identity_mode}`。活动昵称约束与报名 display_name 对齐，动物复用 12 种 enum；明确批准前后是否可改及报名昵称同步规则。本人真实登录读写；以 `(activity_id,user_id)` 唯一保存，现有请求幂等/expected revision 和未知结果恢复语义延用。旧账号资料不变，gathering 的随机记录不挪用。匿名模式若被采纳，仅返回本次活动别名/动物，不透露账号主页、稳定 user_id 或原头像；服务端仍按真实登录身份判断权限。
2. `GET/PUT/DELETE /activities/:id/me/registration-contact`：本人主动填写/确认用途后保存 `{wechat?, phone?, other?}`，至少一项有效、有长度/字符约束；空值不代表同意公开。本人可读取/更正/撤回，删除/撤回不能冒充撤销他人已看过的信息。
3. `GET /activities/:id/registration-contacts`：只给数据库中当前授权组织者最小联系人列表；每次请求及事务核对 currentManagerId，交接后旧组织者立即失权。普通成员、分享者、待审批、游客、客户端自报管理者无权；已取消/退出后的保留及访问期限需产品确认后实现。
4. 联系人独立存储/投影；联系方式不进入 ActivityDetail、公共 roster/memberProfile、邀请 GET/scene、分享卡、日志/通知正文、AI prompt 或任何共享汇总。不得借用 requirements.preferences/location_other/budget_note：这些原文仅本人，不等于组织者联系人权限。

服务端测试矩阵至少包含：本人/他人读写隔离；游客401、普通成员/待审批/分享者403；真实组织者最小读取；交接并发/旧组织者/取消退出策略；同名匿名用户不串身份；非法 animal、长度/空白、未知字段拒绝；幂等重放不重复；账号资料不变；snapshot/roster/scene/share-card/通知/模型输入的敏感哨兵排除。涉及持久化时追加新 migration，并在明确独立开发库用真实事务验证，不在共享演示库试迁移。

## 实际验证与预览

- Node 24.19.0 / pnpm 11.15.1；依赖存在。全工程类型首次发现缺 Prisma Client，已执行仓库 `pnpm.cmd db:generate` 离线生成；未连接数据库。云函数离线套件缺 SDK，已按既有锁文件 npm ci（ignore-scripts）补齐 login/notify 本机依赖，锁文件未改。
- 专项：邀请/分享卡/二维码 5 文件 123 项通过；旧 Screen 同伴互斥 10 文件 361 项通过。后续取消历史与昵称排序增加 2 项，以最终全量日志为准。
- 全工程 `pnpm.cmd typecheck` 通过；`pnpm.cmd build:mini:demo` 通过，详情 chunk 291 KiB 有 Webpack 建议体积提示，不是平台真机包体结论。
- 全量 Vitest 首次 13 文件失败已逐项修复：3 个缺本机 SDK、旧 Screen 替身缺 Image/formatTime、全页任意 img 选择器误认动物图。保留所有有价值断言，分享图断言限定到真实预览容器；随后 207 文件/4044 项通过。最后新增的取消历史/昵称排序回归已包含在最终全量中；修正 Text 替身 className，并在构建完成后使用原超时、4 工作进程执行 `pnpm.cmd exec vitest run --maxWorkers=4`，最终 207 文件/4046 项通过。此前并行全量中的旧自动登录启动超时及后续调用计数污染未通过放宽超时或删断言处理。
- `git diff --check` 通过。没有真实微信 Canvas/相册/扫码、共享 HTTP/DB、AI/地图调用或手机验收；基础双微信历史验收未重做，不列为本轮阻塞项。

微信开发者工具导入当前工作树的 `apps/miniprogram`；先运行 `pnpm.cmd build:mini:demo`，保持仓库 AppID 和 urlCheck。普通活动编译入口 `pages/activity/index?id=<真实活动UUID>`，来源入口追加 `&invitation_id=<同活动的真实来源UUID>`，scene 用真实来源去连字符32位值。不能用离线 fixture UUID 在共享后端冒充活动。本轮未改变共享 API；写报名/需求会写共享数据，人工验收须按团队标识测试记录。新手机预览需有资格成员在开发工具主动生成本分支新临时预览码，旧码不会自动更新；本轮未上传、未替换体验版。

下一轮优先：正式活动动物与匿名身份持久化及联系人权限；独立服务真实小程序码/客户端落盘嵌码；在获准微信开发工具/手机检查整页、键盘和 Canvas/相册，并补原发起人公开投影。

## GitHub 交付状态

已核对连接账号 Ecold07、目标仓库及该账号仓库角色 push=true；远程目标功能分支不存在。命令行 GitHub 连接被重置；插件创建 Git tree 返回 403 `Resource not accessible by integration`，未能发布分支，未创建 Draft PR。账号角色权限不等于集成令牌具备写入权限。已停止远程写入，保留本地受测提交；需要恢复可用的 Git 连接或具备相应写入权限的 GitHub 集成后，推送同名功能分支并创建 Draft PR。Issue #8 未关闭、main 未修改。可粘贴的 PR 说明另存于本机 `outputs/invitation-draft-pr.md`。
