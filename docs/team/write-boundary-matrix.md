# 相邻写入口安全矩阵

此表按同一组问题审查所有相邻写入口，避免把某个页面的修复推断为全应用通过。

- **已测**指本地组件/客户端/服务替身或单元测试，不是真机或真实数据库业务。
- **源码已见**只代表静态检查，不能替代生命周期与竞态复现。
- **待补验**不能算通过，也不直接等于已证实缺陷；先复现，再决定是否修改。
- 服务器从已验证 session 识别 actor；客户端传入的 actor 只用来核对显示意图，不是授权凭证。

| 写入口 | 显示来源及发送身份 | 锁与生命周期最终 preflight | 未知结果与恢复 | 当前证据 / 待补验 |
|---|---|---|---|---|
| 原朋友活动创建 | 来源 `/me` 同时捕获 session；重新核 actor，固定 bearer；响应核 viewer actor | 预览显式确认 + stored-write 锁；最终 transport 前生命周期/session 复验，hide/unload/unmount 失效 | 原持久化 body/key；仅同 actor 重新验证后手工恢复，B 不继承 A 草稿/预览/完成页 | cycle13 两项实际跨账号 POST 失败已修并回归；原 AI mapper→预览/创建正向未改，未调用模型；真机/真实 DB 未验 |
| 一键再约来源→本机草稿→原创建 | 只读来源由服务端核当前 manager；客户端绑定来源活动/actor/session；新创建仍用已验证本人身份 | 来源返回与导入前核生命周期/来源；复制确认锁；新发布沿用原创建最终 preflight | 再约专属账号+来源存储；不覆盖普通草稿；未知发布保原 body/key，不能重新复制覆盖 | 首片仅已结束且未整场取消来源；白名单模板、日期/状态重置、地点费用主动核对。专项离线证据见交付日志，非真实 DB/微信。见 [再约首片](rebook-draft.md) |
| 需求创建 / 草稿保存 | 编辑器来源 session；调用前检查、transport 后会话核对 | 同步 ref 锁；创建/保存不是发布 | 创建未知响应保原 body/key，但仅当前编辑器；草稿冲突需显式加载，刷新不覆盖本地输入 | cycle7/8 的创建恢复与响应边界已测；所有 hide/unload 组合尚未统一验证 |
| 本人需求答卷 | 编辑器 session + 服务端本人身份；expected_response_version | 同步锁；服务端 CAS，不能以新读取版本悄悄覆盖旧输入 | 未知保输入；409 要刷新后确认加载；重复旧 CAS 不声称幂等成功 | cycle4 CAS、响应/恢复已有回归；真实 PG 锁/并发、原生生命周期未验 |
| 发布需求 / 提前截止 / 记录最终选择 | 来源 session、目标版本/权限前后复验 | 弹框前 ref 锁，取消/失败释放；卸载后不发送或旧回调 | 未确认不显示成功，须刷新；不是原活动自动变更 | cycle6 组件已测；hide/unload 不可由卸载测试推断全覆盖 |
| 申请 / 审批 | 来源读取 snapshot session；bound `/me` 核 actor，POST 固定 bearer | stored-write 锁；最终 transport 同步核 session | 原持久化键按 activity+actor；同人新 session 需人工重试，B 不恢复 A 输入 | cycle10 实际 headers/payload 及 16 项独立 race 通过；页面 hide/unload 前发送策略非本轮证明 |
| 本人整份 pending 申请撤回 | 真实来源 session + `/me` actor；服务端仅本人目标，外人/错活动不泄露 | 确认前同步锁；最终 transport 核 epoch/session/来源，hide/unload/unmount 失效，同屏互斥 | 原 body/key 按活动+actor 持久化，同人手工恢复；旧成功键只读，不复活申请，未知不假确认 | 前段最小范围，晚期新动作明确未启用；真实 service/原审批/事务替身与组件客户端专项，非真实 PG 并发。见 [范围与证据层级](application-withdrawal.md) |
| 当前管理者整场取消 | snapshot来源session + `/me` actor；服务端当前管理者先于旧key检查 | 确认前同步锁；全部历史段尚未开始，最终transport和结果确认复验epoch/session/来源；同屏互斥 | 原body/key按活动+actor；同人手工恢复，已成功原键后期只读；不复活或伪撤销已发送请求 | 开始前最小范围；不删除席位/历史/费用/预订，取消保护覆盖相邻服务；PG/微信原生未验。见 [取消保护表](activity-cancellation.md) |
| 管理交接发起 / 接受 / 拒绝 / 撤回 | 真实来源 session/actor；候选与邀请来自有权 GET；服务端按现 manager 或指定本人核身份 | 确认前锁、同屏互斥；最终 transport 核 epoch/session/来源/管理版本；hide/unload 后不新发 | 原 body/key 同 actor 手动恢复；历史 accepted 不等于现 manager，A→B→C 后旧键不夺权；未知不假确认 | 第10迁移只做离线准备，真实PG索引/锁并发与原生未验；范围及最终实际证据见 [交接首片](management-handover.md) 和交付日志 |
| 退出 / 晚到 | snapshot session + actor；固定原 bearer | 弹框前 ref 锁；最终 POST 前核 active/epoch/session/fresh/参与快照；hide/unload/unmount 失效 | 已发不能撤销；晚返回不确认/刷新新页面，保原键，显式重试 | cycle11 实际组件/客户端及同屏正向、互斥；615 是项目总测试数，不是此入口测试数 |
| 主段人工核实 / 确认成局 | 真实读取 session + `/me` actor，服务端复验当前管理者，响应绑定活动/actor | 确认前同步锁；最终 transport 生命周期/来源检查；同屏互斥，开始后新命令双端未启用 | 原 body/key 按 actor 持久化；重放只返当前快照，不复活；旧revision/session结果隐藏 | Slice A 规则、真实服务编排与退出/审批串联使用 Tx 替身；实际客户端/组件正向；真实 PG/真机未验 |
| 直接更换唯一主段 | 真实snapshot session/actor、原主/目标/revision；服务端当前manager先于旧key | 确认前锁、同屏互斥；最终transport身份/epoch/来源复验；父锁后采样原主/目标开始时间 | 原body/key同身份人工恢复；后续已换C时旧A→B键只读C不回切，未知不假确认 | 首片仅原主与目标均未开始；不改段安排/接受/费用/核实预订，清旧成局确认。最终离线证据见交付日志，非真实PG/微信；见 [直接换主](main-segment-switch.md) |
| 仅调整人数上限 | 真实 snapshot session/actor、目标段与原 capacity/revision；当前 manager 先于旧 key | 确认前锁、父活动锁后时间；最终 transport 检查 epoch/身份/来源；来源 ABA 不复活旧操作，同屏互斥不自锁 | 本人原 body/key 手工恢复，只读现在快照；畸形或错目标未知不清键，旧管理者不恢复管理权 | 含保位占用与最低人数下限，条件/planRev/核实预订/成局不变；无新迁移，真实 PG/原生未验。见 [容量与 B1 v2](capacity-only-change.md) |
| 本人安排版本审阅 / 重新接受 | 真实读取 session + `/me` actor；服务端仅本人占位者，版本与可信历史摘要绑定 | 确认前同步锁、最终 transport 生命周期复验；目标段开始时间而非新人报名截止；同屏互斥 | 原键同身份人工恢复，缺历史/错目标/畸形响应不确认；不新增席位或自动成局 | B1 v2 使用明确离线混合历史 fixture 验基础能力，容量非接受条件，严格兼容有效旧 v1；来源 ABA 失效已有回归；无最低变更 writer，不算完整安排变更，真实 PG/原生未验；最终专项结果见交付日志 |
| 创建可转发邀请 / 保存邀请 | snapshot session + `/me` actor 核对；固定 bearer；结果绑定已知 activity/source ID | 创建弹框前同步锁，取消/失败释放；最终 POST 前复验页面代次、来源快照、fresh；hide/unload/unmount 失效 | 未知不更新分享来源/已保存标记；显式重试沿用原 create/save 语义，未新增客户端持久化幂等键 | cycle12 原五项生命周期失败已复现后修复，实际组件+客户端与同屏正向回归；真实分享/PG仍未验 |
| 个人资料 / 头像 | Profile ownerSession 来自已显示账户快照；头像 adapter 校验本人 | 操作锁；账户调用前后 session 检查，头像异步处理另检查 | 不接受畸形成功；保存失败保原资料；临时头像不充当持久化成功 | cycle9 跨账号来源已测；cycle27 本地生日建议不自动保存，资料保存复验 mounted/最新owner/session/来源epoch，旧saved/close及finally不污染新编辑器。头像与全部hide/unload组合仍不能由此推断通过，见 [星座建议及来源保护](profile-zodiac-suggestion.md) |
| 收藏 / 消息已读 | 原账户 session 显式传入；原账号数据隐藏 | 收藏 busy；账户 transport 同步绑定 session | 畸形/未知响应不清收藏、不标成功、不跳转消息；无通用持久化幂等键承诺 | cycle9 运行时/组件与真实服务投影替身测试通过；批量重复/离页生命周期尚非完整证明 |
| AI 整理活动草稿 | 主动点击；输出只填表，不直接创建活动 | source revision + hide 失效，替换已有输入前确认 | 失败保原表单；没有假造真实 AI 调用成功 | 原草稿逻辑离线测试；真实付费模型与多人协调闭环未验/未接通 |

### C1 只读协调来源与候选准备（不是业务写入口）

当前管理者通过服务端两次独立快照校验读取权限/指纹，公开仅去直接标识计数与不透明总指纹，不透传私有位置、逐人答案或可逆身份摘要。答卷 CAS、安排/席位、管理权和截止/开始阶段均影响来源。生产 POST 协调 provider 未接通时明确 503，不回退旧创建模型；离线注入输出前再次核对来源/时间，剥除模型原文，恒 `can_apply:false`。无 UI 入口、无写库和自动应用，不能把本片当全流程已测。见 [C1 接口准备](coordination-preparation-c1.md)。

### WG-09 只读待办（不是通知或新写入口）

仅四类真实源状态，当前actor/session绑定与最终GET前后检查；跨账号隐藏条目/游标，旧响应不能清新会话。来源索引和相关时间边界变化时要求刷新，不拼接伪同快照分页；50候选页零项但有更多不声称全局无待办。卡片只进原活动详情，所有写仍按各行保护，不从待办摘要直接授权。独立接口缺配置只影响待办，不把account失败或读取未知当空列表；本片无消息已读写/订阅/自动通知。候选上限和未实库边界见 [WG-09范围](activity-todos.md)。

### 主动定位与地图入口（坐标请求，不是报名写入）

首页城市与灵感附近捕获原 session、真实 `/me` 身份与页面 epoch；native 返回后、最后 transport 同步发送前和采用响应前核来源。固定原 bearer，hide/unload/unmount、城市弹层关闭/手输/手选、关键词变更令旧操作失效；重新显示不复活旧操作。未发送的旧坐标请求不再发出，已发无法保证撤销。识别城市仍需本人确认且仅存城市名称；原生错误不原文展示或日志记录。地图导航拒绝有安全反馈，不假成功。当前是合成 native/transport 的组件客户端证据，不是微信/供应商实测；详见 [定位来源保护](native-location-boundary.md)。

## 明早按同一顺序抽验

每个入口都执行：A 显示数据 → 修改/选择 → 同步重复点击 → 弹框取消（有弹框时）→ 在身份读取等待期间 hide/unload → 同身份未知结果后刷新/人工恢复 → A/B 切换后再点旧入口 → 延迟旧响应返回。核对最后请求的 bearer、目标、body 与原键，不能只看按钮灰掉或提示文本。

未配置后端时只验准确提示与保输入；匹配后端、迁移及两个测试身份有授权后才能验持久化/权限。失败状态与零记录必须区分。矩阵中的待补验项不能写成“全部入口安全”。

## 回退不是撤销

源码 / dist 回到旧 ZIP **不等于数据库回滚**；也不能撤销已经发出的 HTTP 请求。数据库版本、数据备份与旧写服务是否兼容必须单独评审。尤其答卷 CAS 迁移后不得重新启用旧无条件覆盖写入口；安全回退见 [答卷 CAS 安全回退](requirement-answer-cas.md)。不执行未经授权的生产迁移或恢复。

## 登录返回（不是地点请求或业务写入）

游客灵感只保本次目标/关键词/城市；登录返回actor与原 `/me`、当前session核验一致才恢复输入，不自动重放搜索/定位/收藏。最新明确目标优先于旧目标；hide/unload/unmount、退出、外部身份变化令旧返回失效，旧finally不释放新登录锁。Home另传可选同步守卫至原code/cloud helper写本机会话之前，旧成功迟回不能覆盖新token；其他无参数调用保持原行为，不外推全局通过。失败或未验证不是成功，已发平台登录不能保证撤销。原friend/team目标保留，不生成活动写入。实际 Home + Inspiration + 原客户端组合证据与内存边界见 [游客登录返回](inspiration-login-return.md)，不是所有页面草稿或真实微信登录均已验。

## 活动分享图与本机相册（非活动数据库写入口）

白名单公开行程来自当前详情和已核 outgoing 邀请源，来源 session/actor/快照/fresh/peer busy 与单调 epoch 绑定；主动生成后才绘制/导出，主动保存才调用相册，无自动授权/跳设置/网络图片下载。每个 native 边界前后核当前来源；取消、hide/unload/unmount、账号或来源 ABA 拒绝旧结果和旧回调。旧保存 finally 不释放新操作锁，已发相册保存不能保证撤销；异常结果不显示保存成功。完整图片须保所有段，超限拒绝不截段。无真实QR，原生分享处理器不变。证据仅 actual React Screen/model/canvas 命令替身，不能替代真机；见 [WG08 首片](activity-share-card-slice.md)。

## WG-08-A：公开 scene 读取与导航（非写操作）

- 首页主动扫码捕获当前 session（游客也绑定空 session）、目标 epoch 和单次 native 操作；同步锁在扫码前获取，返回、最终 `navigateTo` 前复验。隐藏/卸载/显式切换目标及观察到的会话变更使旧操作失效，旧 finally 不解锁新操作。
- scene 活动页只接受单一 scene 参数，经严格 codec 后调用原公开 InvitationSource GET（不带 Bearer），以严格 DTO 的 canonical activity/source 打开原详情；不造 source revision，不自动登录/收藏邀请/报名。
- 页面/来源/session 的单调 epoch、最终 GET/redirect preflight、错误及晚返回检查贯穿同一次读取；session-only 变化、取消或 hide→show 后需要主动重试。普通 id 详情仍原控制器，未增加原生分享 hook。
- 原生导航已交付后不能保证撤销；HTML 404/405、503、坏 200 不当不存在或成功，不显示原文响应、token、坐标或私有信息。缺二维码 provider 不用此入口冒充真实码。

格式/验收详见 [公开 scene 入口](invitation-scene-entry.md)。

## WG03 申请公开入口归因

新归因GET只读，来源绑定当前服务端actor/session/revision与完整申请集合；旧错误/缺迁移不当零，取消/离页/观察到的身份ABA隐藏旧记录。带来源新申请不改变原幂等结构；首次写在原父锁/事务里核same-activity source，源读取后再采时核截止，旧成功key先回当前快照。前端最后发送/确认绑定原页面代次；unknown原body/key/source不改，不因换入口或旧版本拒绝去来源重发。无来源旧请求与审批策略保持原样。第11迁移不回填历史、不删源。见[完整边界](application-invitation-attribution.md)。

## 取消历史展示（没有新增写入口）

本人参加、行程、更多说明、B1只依据当前详情的活动/环节取消标记区分历史与有效状态；不清空旧接受、席位、费用、核实或预订，不造版本或事件。原apply/整体approve/reaccept的取消保护仍在服务端，未取消段按原规则。B1 unknown原key恢复仍由原会话/来源代次守卫执行，只读回当前取消历史不能冒称新的有效接受。未扩大公共历史名单权限，未决定关联问卷规则。见 [范围](cancelled-history-display.md)。

## WG07 固定邀请／补位文案

见 [本地固定模板](invitation-fixed-template.md)。主动生成、编辑、明确替换和复制；无自动查询/登录/模型/报名/发送。旧稿在来源/会话/离页或时间阶段变化后不可当当前事实复制，同身份修改保留供核对、跨账号不复用；复制失败保输入，已交给原生的请求不能保证撤回。真正微信剪贴板与分享收件端另验；本片不改变问卷/接受规则，也不纳入未签二维码候选。

## 仅延长报名截止与B1 v3

按 [延期范围](deadline-extension.md) 检查：目标未取消未开始、新截止晚于原值与服务端当前时间且不晚于原开始；只恢复该段后续加入资格，不自动批准/占位/成局。与原审批同父锁，原成员接受不变、重接受不套报名截止；三类完整不可变历史与旧v1/v2兼容必须同测。确认先锁、最终来源/session/epoch preflight与首发时间复核；unknown固定原body/key，后期成功旧key只取当前状态。真正PG/微信另验；未定最低/问卷策略不涉及。


## 人工预订声明／本段历史

- 写仅当前manager，绑定活动/段/计划/原unknown及原key；父锁与整事务、锁后/写前时刻、最终固定session transport preflight；只写booking状态/活动rev/事件/key，保持核实成局与接受席位。
- 读仅当前manager本段专属事件，同快照权限和最小投影；旧manager无权，取消后现manager仍可读。无/旧/坏/超限历史不混成外部无订单，字段不含个人资料、订单或actor UUID。
- 同屏读写忙互斥不自锁；确认取消、源/身份ABA、离页、未知原key、已经发送无法保证撤回和旧finally都须实际组件回归。没有反向标记、订单取消或支付调用。详情见 [人工声明首片](booking-declaration.md)。
