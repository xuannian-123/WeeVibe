# 核心流程地图选点接入

2026-10-29，PR47，分支 codex/native-map-picker-20261029。已同步 PR46 合入后的 main 3b7a1a6，并读取核心整批审核 0da45d2 的新规则。本批只改地点能力及挂载，不改批审结构、头像昵称门槛、问卷必答/折叠或 AI 文案。

## 页面结果

- 朋友及团建填写：GatheringOrigin 提供“地图选择出发地”，仍可手动填写、获取定位或高德搜索。不填的含义沿用核心集成新规则，本批不另造同意或参加状态。
- 新筹备集合点、团建候选地点：GatheringMapPlace 复用既有 gg 样式，回填名称、地址、GCJ-02 坐标与微信来源，仍需保存表单。
- 正式活动创建、再约、旧 requirements 候选地点和 Issue5 编辑：复用 VenuePicker，地图为首入口，高德搜索备用。Issue5 仍走版本、修改预览、影响确认和重新接受；同名同地址的新坐标也不会被旧来源覆盖。
- 取消不改旧值，进入不定位或搜索；已选坐标作为重新选点中心。过长地址拒绝回填，保留原值，不静默截断。

## 来源、保存和隐私

venueSelectionSchema 保留高德查询来源，新增 {provider:'wechat', source_api:'wx.chooseLocation'}，不伪造高德 checked_at/POI ID 或商家核实状态。正式活动沿用 name/address/source_url 网络契约，坐标仍存原有高德地图标记链接；该链接用于打开地图，不代表经高德查询或商家确认。

筹备 JSON 增加可选 place_venue 和 candidate_places[].venue；旧 JSON 不补默认键、不改历史请求。手工编辑清除旧地图记录，契约拒绝名称/地址与记录不一致。团建集合地点和地址未都被明确公开时，参与者不收到 place_venue，避免坐标/地址经来源对象泄漏。AI 输入仍仅用原有公开文本，不增加坐标和地图来源。

私人出发地仅写现有 private.origin，不放入公共字段、AI 或通知。公共筹备及 requirements 的新地图 JSON 需要配套 API；旧部署不能当作新版已接通。不新增数据库列或迁移。

## 返回与权限

chooseMapPlace 兼容 callback-only 和 Promise。useMapPicker 仅为当前原生交互允许一次 hide/show，并在原生成功先于 onShow 时等页面显示后回填。账号、页面栈所有者变化、卸载、禁用/只读或额外离页会丢弃旧结果；普通网络请求和精确定位仍保持原离页作废规则。不清理会话、草稿或滚动状态。

app.config 保留 getLocation，新增 chooseLocation 声明与产物检查。不改 AppID、云登录/HTTP 目标或域名校验。代码声明不等于后台资格/隐私指引已配置，本批未操作后台；原生地图、键盘、安全区、滚动与真实权限仍待手机验证。

## 集成与验证

与整批前端的文件分工已留在其工作树 .working/map-picker-coordination-20261029.md。此为本地交接，不代表另一对话已读取或确认。后续页面复用 GatheringOrigin / GatheringMapPlace / VenuePicker，不平行实现另一套地图逻辑。

最终检查见 PR47。没有部署 API、修改共享数据库、上传预览、替换体验版、提审或发布。离线/CI 不等于微信或手机验证。

## 本轮检查结果

- pnpm test：212 文件 / 4068 测试通过，包含既有核心流程及地图回归。
- pnpm typecheck：全工程、普通测试及集成测试类型通过。
- pnpm build:mini:demo 与 node scripts/check-mini-demo-artifact.mjs：通过；cloud 登录/HTTP 目标、urlCheck、精确定位及新增选点声明通过。保留已有 CSS 顺序和详情包 297 KiB 建议提示，本批未改全局样式。
- pnpm build:api：通过，standalone Prisma WASM 产物检查通过；不表示数据库/微信联调成功。
- 首轮全量检查因新工作树缺少两套云函数依赖，有 3 文件未加载；按锁安装依赖后，最终全量 212 文件全部通过。没有修改锁文件。
- 未执行：新选点手机验收、微信后台资格与隐私指引核验、新版 JSON 的真实共享 API 联调。本轮无共享部署或迁移。
