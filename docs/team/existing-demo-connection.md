> 2026-10-27 当前状态：37 个 API 路由对应的 v38 服务端已部署至原独立演示函数，全部 12 条迁移已在对应演示库应用；实际微信云登录、需求列表、账号和待办读取通过，详见[部署证据](v38-deployment-20261027.md)。团建按登录后填写的最新决定开放；多人协调模型仍未接通。下文保留 ZIP 接线阶段的历史比较，旧“接口未部署、严格群资格关闭、迁移未执行”均已被本轮记录覆盖。

# 已有演示连接与新版接口兼容

**已连接并更新演示后端；手机旧预览、体验版及正式版未自动更新。**

用户提供的 `WeeVibe-main.zip` 的提交标记为 `0b635e9fba728a40a93ab07b6512af02cb475518`，SHA256为 `732fed488cf99571c2cddb51290ca8aaa085f3ba11875cd64732b091b636c236`。其中公开配置、构建脚本、Taro配置及项目AppID与本次源码逐字节一致；不是缺少后端项目，而是此前普通构建没有启用已有连接。

## 连接基线与后续构建

- 用 `config/miniprogram-demo.json` 的公开字段，在独立目录构建本包 dist：`cloud` 登录、`cloud-http`业务传输；环境 `cloud1-d2gl86h3t5a8b5369`，普通登录函数 `weegoLogin20261025`，业务HTTP函数 `weego-api-demo`。
- 保留原 AppID `wxaa06e111e33f6ddd`、基础库3.16.2、`urlCheck=true`。没有把服务端密钥、PG连接串或私钥放进小程序。
- 后续重建相同连接使用 `pnpm build:mini:demo`；普通 `pnpm build:mini` 仍为默认空API。项目内已有脚本只读取公开配置，不部署后端。
- v29 配置基线的独立构建复用现有已验证依赖。副本pnpm元数据触发安装失败后，使用同一公开字段运行既有Taro CLI；未安装新依赖。该次配置基线的业务源码为v28冻结版，129套2006测试与79独立探针为该冻结版证据；该次配置版新增的是实际小程序构建和配置/字节核验，不冒充重新跑过全部业务测试。
- 没有调用共享云登录、创建活动、写数据库或调用真实地图/模型；没有改云函数、收费设置、登录函数或发布微信版本。构建成功不证明账号有云资源/微信体验资格。

## 精确兼容范围

上传基线有14个API路由、3条迁移；v29配置基线有32路由、10条迁移；名单和本轮人数上限各增加1个路由，申请来源再新增1个只读路由，当前35路由、11条迁移。原14个route文件和原3条迁移逐字节未变。原活动创建/详情/审批请求契约保留；申请输入仅新增可选公开入口ID，原无来源body仍兼容；原详情响应只新增可选晚到字段，因此旧基础协议可兼容基线响应（新字段不能静默降级）；这不是对当前共享服务部署版本的实时验证。

| 层级 | 当前判断 |
|---|---|
| 原登录、`/me`、活动创建/详情/申请审批、原AI草稿、地点搜索/附近/步行、health/ready | 上传已有实现和原公开接线；运行权限、额度、供应商和当前实际部署仍须分层验证，不能自动试写共享数据 |
| GO/我的资料/收藏/消息、头像 | 新 `/account`、`/account/avatar` 不在上传基线；当前账号列表可能报接口未部署，不能当零活动或登录失败 |
| 活动新增操作 | 本人申请撤回、安排重接受、整场取消、成局、管理交接（列表/单项）、邀请来源、换主、退出晚到、再约，共10个新增路由；旧详情可读不表示这些操作可用 |
| 仅人数上限 | 新 `/activities/:activityId/segments/:segmentId/capacity`，无新迁移；B1 返回明确 v2 并兼容有效旧 v1，需匹配客户端，见[范围与兼容](capacity-only-change.md) |
| 公开分段名单 | 本轮新增 `/activities/:activityId/roster`，读当前报名名与保位状态，无新迁移；旧后端404不代表没有成员 |
| 申请入口归因 | 新 `/activities/:activityId/application-attributions` 与申请可选来源字段，依赖第11迁移；旧404不是没有邀请人，见[兼容说明](application-invitation-attribution.md) |
| 其他新路由 | 邀请来源详情、需求创建/详情/协调、跨活动待办、城市反查，共6个；与前两类为v29原18新路由，加名单和人数上限后为20，须匹配新版后端 |
| 严格群资格/协调模型 | 即使新版后端上线，未提供可信群验证时团建发布仍关闭；协调仅接口准备，真实provider未实现/未配置时仍503，不伪造AI方案 |

账号页失败不等于原朋友创建不可用；反过来成功登录或一个原接口成功也不等于新账号/需求功能已部署。云登录函数签发会话所用API与业务HTTP必须保持同一数据库/信任链；不擅自只改函数名或另接一套库。

## 对应数据库差异（未在目标库执行）

保留原 identity_baseline / activities / cloud_login_use 三条；按迁移历史检查实际缺失项，不能盲目重放DDL：

| 新迁移目录 | 增量与要求 |
|---|---|
| `20261026115000_account_private` | PrivateProfile、SavedVenue、MessageRead |
| `20261026120100_participation_lateness` | Participation 增 lateArrivalAt / lateNoticeAt 可空列 |
| `20261026120200_requirements` | RequirementSurvey、RequirementSubmission、RequirementWriteBudget |
| `20261026120500_avatar` | UserAvatar |
| `20261026120900_verified_invitation_entries` | InvitationSource、ReceivedInvitation |
| `20261026141500_requirement_response_version` | responseVersion默认1及正数约束；禁止旧无条件答卷writer混跑 |
| `20261026191500_management_handover` | ManagementHandover及状态enum、约束与每活动唯一pending部分索引；新版取消依赖此表 |
| `20261027040700_application_invitation_attribution` | 申请可空来源及同活动复合外键/索引；旧数据不回填，未实库应用 |

已有对共享演示业务函数及对应库更新的授权，但仍须先确认目标、当前迁移/schema、可恢复备份及旧代码包，才可执行变更。新表是否已向现有runtime角色授予必要最小CRUD必须核对，不能用owner运行API或擅自扩大其他库/表权限。若备份/回退或权限范围不清楚，停止依赖步骤。

源码包回退不回滚数据库，不删新表/历史，不复位当前管理者或安排确认；答卷CAS后不能重启旧writer。已发请求不能保证撤销。先看[获准发布预检](authorized-release-preflight.md)及[管理交接安全回退](management-handover.md)，再由获准环境执行；不将历史SELECT1或health200当完整schema/业务验收。

当前源码在v29配置基线上继续完成名单与仅人数上限首片，后续全量/构建以本包最终日志为准，不将v28的2006/79当作新回归。原公开配置不变，构建仍明确使用 `build:mini:demo`。

打包前必须执行 `node scripts/check-mini-demo-artifact.mjs`。该硬门禁只读当前源码公共配置与编译结果，要求既定AppID、urlCheck、基础库以及实际cloud登录和cloud-http调用分支；普通空API产物必须失败。它不访问服务、不改变普通build默认，也不证明新后端已部署。改变目标需新的明确配置决定，不能为通过检查关掉门禁。

本片从已交v33独立实现，不含未完成独立末轮审阅的QR服务边界候选。新的归因路由没有真实HTTP/目标库验收；配置构建成功不代表部署完成。
