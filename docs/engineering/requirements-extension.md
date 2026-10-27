> 当前集成已变更原交付策略：朋友需求可独立筹备，团建分享后登录即可填写，不要求群成员验证；字段权限按 [集成决定](../team/v38-integration-decisions.md) 执行。管理者逐人仅看时间和意向环节，其他原始字段仅本人可见，汇总向已登录查看者提供。旧自由文字不推断成价格或逐人公开。第 12 条迁移放宽独立朋友筹备约束，下文第 2/8 条等为原 ZIP 历史说明。

# 需求收集扩展：接口、边界与验收

本次增量沿用现有微信身份、会话、Next.js API、Prisma/PostgreSQL 和活动事务。需求填写**不等于报名、占位或接受最终安排**，不修改原有申请审批规则。

## 接口

所有接口都要求既有 Bearer 会话；不信任客户端 user_id、manager、openid 或 group_id。

- `GET /api/v1/requirements`：本人管理的收集和本人已回答的朋友收集，最多 100 条。
- `GET /api/v1/requirements?activity_id=<uuid>`：朋友活动的收集；无收集或普通成员查询未发布草稿时返回 `{collection:null}`。
- `POST /api/v1/requirements`：`{action:'create',kind:'friend'|'team',activity_id?,idempotency_key,draft}`。
- `GET /api/v1/requirements/<uuid>`：有权查看的收集快照。
- `POST /api/v1/requirements/<uuid>`：`save-draft`、`publish`、`respond`、`close`、`finalize`，均携带 `expected_revision`。

完整输入和返回类型见 `packages/contracts/src/requirements-api.ts`；未知字段被拒绝。写接口为 POST，兼容现有微信原生云 HTTP 适配器。

## 已实现规则

1. 朋友收集绑定真实活动，当前活动管理者创建和操作；分享进入后，已登录用户可填写本人需求，不增加填写前审核。
2. 团建草稿支持服务端私有保存与恢复。**严格微信群成员验证未接通，发布、收集答案、定案均服务端拒绝**，不接受客户端提交的已验证标记；没有偷偷降级为开放投票。
3. 草稿可以不完整。发布时校验题目、候选、重复文字、稳定 ID、实际环节归属、明确时区时间；地图候选可持久化所选高德地点来源，名称必须与来源一致，手改名称后应清除地图来源改为自定义；只支持北京时间展示。截止不得晚于活动最早有效环节开始。
4. 为保证一致性，首版采用较简单的强约束：**发布后题目结构和截止时间锁定**，即使还没有答卷也不能编辑；无重新开放入口。
5. 响应以 `(collectionId,userId)` 唯一保存。重复提交更新本人同一份答卷，不重复计票。单选、多选、“其他”文字、全局题和所选环节题均校验。
6. 服务端事务先锁关联活动、再锁收集、读最新状态，随后采样服务端时间。自然截止和人工截止后首次提交与修改均拒绝。原有最终方案接受操作未被需求收集锁禁。
7. 每账号每分钟最多 60 次需求写操作，计数在数据库持久化，失败的业务操作也消耗预算；这只是基础防刷，不承诺完全阻止恶意填写。
8. 管理者看到回答人数、选项计数、允许公开给局头的时间／预算／偏好／自定义答案；多选选项票数可以超过人数。只有本人能拿到 `private_origin`。
9. 管理者查询其他答卷时 SQL 投影不读取 `privateOrigin`；对外投影只白名单读取昵称，不返回生日、MBTI、完整个人资料等。没有导出、日志或模型转发个人出发地点。活动分享身份仅额外投影发起者头像和昵称：头像为服务端已规范化 JPEG 的有限资产字段，不提供通过任意用户 ID 读取头像的公共接口。
10. 管理者仅在收集关闭后定案。当前 `final_selection` 是管理者确定的需求候选及说明，**不会自动改写原活动的时间、费用或地点，不会替成员接受安排、不生成席位**。需要实际变更原活动时仍须独立遵循原安排确认流程。

## 站内通知

账号接口从真实收集记录及服务器时间生成截止通知，从持久化 `finalized` 状态生成“定案建议已更新，需另看正式活动安排”通知。仅当前管理者或有本人答卷的用户可以读取和标记已读；不读取别人的答卷字段。已读使用现有 `(userId,messageId)` 唯一记录，重开可恢复。自然截止和晚于自然截止的人工关闭共用同一截止事件身份，不重复冒充新通知。消息带 `requirement_id` 定位收集页；没有微信推送或订阅消息。

## 数据及迁移

- `RequirementSurvey`：草稿、版本、截止、关闭、最终候选及创建请求去重信息。
- `RequirementSubmission`：每用户一份答卷；管理者可见答案与本人出发地点分字段存储。
- `RequirementWriteBudget`：每用户／范围一个当前预算桶，无原始答卷或凭证。

基础迁移为 `20261026120200_requirements`；单答卷版本修复另增加 `20261026141500_requirement_response_version`（本轮未执行，见[兼容说明](../team/requirement-answer-cas.md)）。仅在明确授权的独立开发数据库执行。发布前须先迁移并重新生成 Prisma Client；旧共享 API 不会因源码变化自动升级。

回退须先备份新数据并关闭旧版答卷写入口；不可直接恢复无条件写入的旧服务继续开放答卷，详见[单答卷 CAS 安全回退](../team/requirement-answer-cas.md#增量迁移与安全回退)；仅在确认要丢弃本扩展记录且有数据库授权后按子表到父表顺序删除 `RequirementSubmission`、`RequirementWriteBudget`、`RequirementSurvey`。不删除原活动、席位或用户表。

## 验证分层

- `tests/requirements.test.ts`：纯规则。
- `tests/requirements-backend.test.ts`：事务替身检查；含锁后截止、本人更新、管理者序列化隐私、手动关闭及关闭后不重开。**不是 PostgreSQL 并发验证**。
- `tests/requirements-backend-routes.test.ts`：真实路由函数鉴权和云响应封装；没有真实微信登录。
- `scripts/check-requirements-integration.ts`：仅限明示的隔离本机 PostgreSQL fixture，检查真实持久化和锁等待越过截止。脚本拒绝远程、错误端口或非指定数据库。是否实际执行以本次交付日志为准。

本模块没有生产部署、真实微信群成员验证、收款、退款或自动费用分摊。
