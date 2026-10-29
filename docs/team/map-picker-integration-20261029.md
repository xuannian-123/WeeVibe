# 核心流程地图选点接入

2026-10-29。基于核心流程方案 C 的受测提交 99b90cb，新分支 codex/native-map-picker-20261029；与正在推进的整批前端设计隔离。

## 本批交付

`apps/miniprogram/src/platform/map-picker.ts` 导出 `chooseMapPlace({ guard, center? })`。仅在用户主动点击时调用，返回 `MapPickedPlace | null`。成功包含来源 `wechat_choose_location`、名称、地址、GCJ-02 坐标（6 位小数）；取消返回 null，调用方保留旧值。配置、权限、失败使用安全错误码，不显示原始平台响应。不读 GPS、不保存、不提交业务，不自动打开设置；复用既有隐私授权检查。原生接口自行处理地图选点权限，不以系统精确定位可用作为手动地图选点的前置条件。

模块防止重复原生页面；打开前、授权后和返回后均核验 guard，旧账号或失效页面的结果不能写回。兼容 callback-only 与 Promise 平台实现。没有接入页面、配置、契约或业务后端，现有界面不因本 PR 自动变化。

## 核心流程集成方接入顺序

1. 整批设计中统一安排“地图选择”、已选地址及重新选择、取消、权限失败状态。私人出发地仍可不填，表示愿意配合安排；新活动昵称规则沿用核心集成最新决定，不要求账号头像昵称。
2. 先接 `features/gatherings/origin-search.tsx` 的私人出发地，朋友与团建复用。将结果转换成现有 private.origin 的 label（最多 300 字符）、latitude、longitude、crs；不要把出发地放进共享地点、通知或 AI 请求。不要在适配层截断并冒充完整地址，展示名称/地址与存储长度策略由调用方明确处理。
3. `features/activity-create/venue-picker.tsx` 同时服务正式活动和 requirements 候选地点。公共地点接入前，先扩展 VenueSelection 的来源联合并检查契约消费者、后端解析和历史快照；旧高德来源全部兼容。微信选点不带高德 POI ID、checked_at 或 source_api，不能伪造这些字段，不能直接 venueSelectionSchema.parse 原生结果。是否需要迁移以实际保存模型为准，未预先断言。
4. Issue5 的修改入口继续走原版本、预览、影响确认及重新接受，不通过选点绕开现有事务。
5. 全局 app.config 的 requiredPrivateInfos 和微信后台实际接口资格、隐私指引须同步核验 chooseLocation。本批不修改共享配置，避免与整批集成冲突；现有 getLocation 已获批不代表 chooseLocation 已获批。

## 返回与生命周期重点

guard 由调用方提供，必须检查账号、所有者是否仍在、是否只读/定案、请求是否过期。不要简单使用 `() => {}`。当前 useGatheringSource.ticket 会在 useDidHide 递增 epoch；地图原生页在不同平台上的 hide/show 和回调先后仍未实测。接入时须有针对原生页面的受控返回处理，不能全局取消离页失效保护或误把所有返回结果一律丢弃。应单独验证用户改账号、离开原表单和选点回来三种情形。

## 本地验证及剩余项

Node24.21.0 / pnpm11.15.1；冻结锁文件离线安装成功，小程序类型检查通过。地图适配与既有定位权限共 30 项离线测试通过，覆盖原生回调/Promise、取消、无配置、拒绝、无效坐标、重复打开和失效调用方。未连接数据库/供应商，没有生成共享活动。

尚未执行：页面接线、原生返回/草稿/滚动恢复、微信后台资格核验、隐私声明及手机选点。没有部署后端、迁移数据库、上传预览、替换体验版或正式发布。
