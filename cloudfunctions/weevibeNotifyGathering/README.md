# 筹备填写通知发送器

这是新增的普通云函数，入口为 `index.main(event, context)`，通过 `wx-server-sdk` 云调用发送微信订阅消息；当前调用身份只从独立锁定的 `@cloudbase/node-sdk.parseContext(context)` 解析，不读取可能残留上一调用身份的 `getWXContext()`。旧 `weevibeLogin` 和登录服务不变。只有定时器批处理可以调用发送链；小程序直接调用会被拒绝。

## 平台配置

1. 将普通云函数部署到已关联小程序的云环境，运行时 Node.js 20.19 或更高，函数超时至少 30 秒，建议 45 秒。
2. 在函数目录执行 `npm ci --ignore-scripts`，或上传代码时让平台安装锁定依赖。包版本及完整依赖锁定在本目录。
3. 保留 `config.json` 中 `permissions.openapi: ["subscribeMessage.send"]`，并上传名为 `gatheringSubmissionNotify` 的定时触发器。配置为每分钟一次；每次默认最多 5 条，最多允许 10 条。
4. 确认云环境关联当前小程序，微信后台已有实际可用的订阅模板，且小程序版本中已存在 `pages/gathering/index` 页面。联调使用 `developer` 或 `trial` 跳转类型。
5. API 和函数都配置下表中的对应环境变量，最后再设 `GATHERING_NOTIFY_ENABLED=true`。没有模板字段配置时函数停止发送，不会猜测模板。

| 环境变量 | API | 云函数 | 用途 |
| --- | --- | --- | --- |
| `GATHERING_NOTIFY_ENABLED` | 必需 | 必需 | 仅 `true` 开启 |
| `GATHERING_NOTIFY_ENV` | 必需 | 必需 | 当前云环境 ID，两端相同 |
| `GATHERING_NOTIFY_APPID` | 必需 | 必需 | 已关联小程序 appid，两端相同 |
| `GATHERING_NOTIFY_WORKER_SECRET` | 必需 | 必需 | 每环境独立的至少 32 随机字节 base64url 密钥，只放服务端密钥配置 |
| `GATHERING_NOTIFY_TEMPLATE_ID` | 必需 | 必需 | 后台确认的真实模板 ID |
| `GATHERING_NOTIFY_API_ORIGIN` | — | 必需 | API 的 HTTPS origin，不能带路径、查询或凭据 |
| `GATHERING_NOTIFY_TEMPLATE_FIELDS` | — | 必需 | JSON 字段映射，见下方说明 |
| `GATHERING_NOTIFY_MINIPROGRAM_STATE` | — | 可选 | `formal`、`trial`、`developer`，默认 `formal` |
| `GATHERING_NOTIFY_BATCH_SIZE` | — | 可选 | 1–10，默认 5 |

2026-10-28 微信后台已选用并生效一次性“活动进度提醒”模板，模板 ID 为 `aVkr_cF1h4dR0RTXflHXxVFRItt5xzlYoxzXguniW4Q`，使用场景为“活动成员提交或修改填写内容提醒”。长期订阅库当前没有可用模板，代码按一次性授权处理。

该真实模板必须配置 `GATHERING_NOTIFY_TEMPLATE_FIELDS={"thing1":"service","thing2":"event","thing3":"hint"}`：

| 后台真实字段 | 映射 | 实际值 |
| --- | --- | --- |
| 活动名称 `thing1` | `service` | `WeeVibe活动筹备` |
| 活动进度 `thing2` | `event` | `有成员已提交填写` 或 `有成员更新了填写` |
| 温馨提示 `thing3` | `hint` | `点击查看最新填写` |

以上每项均不超过 20 字。公开演示参数见仓库的 `config/gathering-notifications-demo.json`，包含已确认的云环境、appid、模板及 `developer` 跳转类型；该文件不包含密钥，也不会开启发送。

通用字段映射格式示意为 `{"thing1":"event","thing2":"service","time3":"time"}`，这仅是其他模板的格式例子，不能代替上方真实模板配置。可映射的值全为固定文案或事件时间：`event`、`service`、`hint` 对应 `thingN`，`time` 对应 `timeN`，`actor` 对应 `nameN`（固定“活动成员”），`status` 对应 `phraseN`。发送内容不包含用户答卷、预算、个人出发地点、昵称或活动自由文本。跳转链接只包含服务端提供的筹备 ID 和 `entry=share`。

## 授权与持久投递

小程序通过真实点击触发 `wx.requestSubscribeMessage`。服务端 `GET /api/v1/gatherings/notifications/subscription` 提供当前模板配置；`POST` 接受 `{gathering_id, authorization_key, template_id, result}`，其中 key 使用项目现有 `mini-...` 幂等键。每个 `accept` 只记录该组的一次授权意向，微信仍会独立检查实际订阅权限；拒绝不会增加额度。记录接口要求当前 appid 的真实微信身份绑定，不会因订阅把访客加入活动。

授权只能用于记录之后发生的本组事件。后来增加的授权不会把历史站内通知灌入微信。每个新答卷版本在业务事务中保存独立事件、收件人及 outbox；同请求重放不再新增。朋友出游通知局头及更早已经提交的人，团建仅通知局头，本人不自收。

内部 `POST /api/internal/gathering-notifications/claim` 与 `/ack` 使用 HMAC，绑定方法、路径、环境、appid、用途、请求体、60 秒时间窗和 PG 持久 nonce。API 只返回服务端绑定的收件人，客户端不能指定收件人、模板或正文。claim 的 45 秒租约和一次授权消耗同时提交，PG 只保存租约 token 的 hash。每个 claim 最多清理 100 个已过期 nonce。

发送成功只表示微信 API 返回成功，不是用户已读。发送超时、网络不明或租约过期记为 `unknown`，不自动重发；发送成功但回执丢失也可能变为 `unknown`，因此不承诺端到端 exactly-once。回执可重试，重试回执不再次调用微信。仅明确 `45009` 限流会延后 3 分钟、沿用原授权、最多尝试 3 次；其他已知拒绝终止，不会为同一事件再消耗新授权。所有这些失败均不撤销已保存的答卷或站内消息。

## 验证

`tests/gathering-notification-worker.test.ts` 覆盖签名绑定、客户端拒绝、字段配置、回执重试和发送未知态。`scripts/check-gathering-notifications.ts --fixture-only` 只接受 loopback 的 `weevibe_acceptance_*` 临时库，使用实际 PG、认证和路由验证通知事务及发送器；微信调用明确注入离线 fixture，不会向真实微信发消息。生产验收仍需真实账号的一次点击授权及一次实际消息收取。

平台依据：[CloudBase 订阅消息云调用](https://docs.cloudbase.net/en/recipes/add-subscribe-message-cloud-function)、[定时触发器](https://docs.cloudbase.net/cloud-function/timer-trigger)、[微信发送订阅消息 API](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/mp-message-management/subscribe-message/sendMessage.html)。
