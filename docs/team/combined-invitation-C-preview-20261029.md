# C 前端与正式活动邀请/详情组合

2026-10-29。用户批准先整合其它对话的最新已确认界面，再检查所有入口/返回和展开区域，并生成微信临时预览。工作分支仍为 codex/invitation-detail-integration-20261029，未改其它工作树。

## 组合基线

main固定为9764e19；本分支44e3422包含已确认邀请详情及新完整安排。另从design-C-faithful工作树固定108个修改/新增文件，读取后逐字节复核，路径与SHA256记录于本机 `.working/combined-c-snapshot-20261029/manifest.json`。与本分支邀请改动的文件交集为0。包括已获认可C首页/活动列表、账号真实子页栈、外围9页面、小橘头和现有公共文本隐私守卫。

核心工作树099afa4之后的gathering workflow、服务端、通知、契约和迁移仍在编辑，未纳入本次共享API客户端预览；不把未部署新协议接到旧共享API。该工作仍由原工作树继续，不覆盖/代提交其修改。原发起人公开投影与真实报名码仍待后续后端协作，本次没有补假数据或假码。

## 正式活动统一展示

报名、审批、本人参加、成局、退出、安排变更、管理交接、容量/截止/预订及分享区域迁到新的ActivityUI面板/输入/提示，并直接复用已确认的CAction按钮。操作区统一ActivitySectionHeading，不再使用初版activity-hero标题栏或初版通用Panel/Field。现有业务控制器、幂等、权限、未知请求恢复和跨功能写锁保持。完整行程仍只挂载新ActivityArrangement。

返回活动只切换本页操作区，保留表单；离开详情时有真实上级页面则navigateBack，否则独立邀请回首页。消息指定applications/arrangement/handover入口继续直接打开相应区域。已有账号页面栈、筛选及滚动恢复保留。

## 验证

- 全工程类型检查通过。
- 全量221文件/4254项回归通过；之后追加两项入口/返回测试，详情组合套件13项通过。未据此称为真实手机业务验收。
- 原有profile-zodiac测试补ScrollView原生替身；todos历史导航测试改为实际C路由、真实退出确认及全部show生命周期，保留旧隐私、异常、账号隔离断言。
- 显式演示配置小程序构建通过。没有更新依赖、后端或数据库。
- C外围实际组件116组布局、22项交互通过，0运行错误/坏图/外部请求；邀请详情14组角色/宽度/展开状态检查通过。离线原生接口替身不登录、不发业务写入。
- 本地组合入口：outputs/combined-preview-20261029/index.html。构建文件逐一冻结到本机 `.working/combined-phone-project-20261029`，公开回执在outputs下receipt.json。

## 微信预览的实际阻塞

IDE CLI islogin确认true，open本工程成功；普通preview/auto在Fetching AppID permissions阶段报ECONNRESET/TLS连接提前断开。进程级系统代理与HTTPS代理适配尝试仍失败。未关闭URL/TLS校验、清除会话、重置AppSecret或修改旧服务；未上传体验版。没有本轮新微信二维码，不能交付旧码或离线截图冒充。

需恢复开发者工具到微信权限/预览服务的正常连接后，用已冻结的project.config.json+dist重试临时预览。微信原生入口/返回、Canvas/相册和本版完整业务链仍须真工具/手机核验，不把浏览器fixture与既有双微信验收扩大为本次通过。原生自动化本轮也未连通。
