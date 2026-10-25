# WeeVibe 名称同步检查

2026-10-25。补齐前一轮只更新界面及公开说明的范围；本页说明已迁移的工程名称和明确保留的兼容值。

| 范围 | 当前结果 |
|---|---|
| 本机项目 | 实际源码与.git位于D:\Projects\WeeVibe，旧目录只保留迁移说明与兼容链接 |
| GitHub | [xuannian-123/WeeVibe](https://github.com/xuannian-123/WeeVibe)，原Issues、PR及提交保留 |
| 私有包 | @weevibe/web、@weevibe/miniprogram、@weevibe/contracts、@weevibe/api-client；导入、锁文件、Next配置和命令同步 |
| 身份函数源码 | cloudfunctions/weevibeLogin；测试、Docker及CI引用同步 |
| 构建及检查 | __WEEVIBE_*构建常量、WEEVIBE_CHECK_API_BASE_URL、weevibe-api-scf.zip及CI临时资源名称 |
| 本地Markdown | 当前说明使用WeeVibe；两份带旧名的文档已改名并同步引用；历史候选和审计证据明确标注 |
| 既有对话 | 五个标题已通过官方接口修改并回读；空闲对话同步新目录及背景，活跃写入中的对话不强制中断 |

前后端结构和业务规则不因命名清理改变。微信账号仍单独申请“即聚行”，审核状态及项目内展示名见[品牌说明](./branding.md)。

## 剩余旧字符串的范围

下列值保留是为了兼容现有客户端和云端，不作为当前项目名称：

- 已部署的函数、环境及数据库资源名称，服务端WEEGO_CLOUD_AUTH_*、WEEGO_API_BASE_URL配置项。
- 云身份签名域WEEGO-CLOUD-LOGIN-V1、issuer/audience、x-weego-cloud-signature；函数proof.cjs迁移前后逐字节相同。
- X-Weego-Response-Envelope、weego.http.v1及health的服务标识；旧预览仍按这些协议解析响应。
- weego_session_v1和原用户隔离的近期活动、草稿与不确定写入键；继续恢复原身份及原请求。
- 旧本机验收库前缀兼容、历史Git提交、旧候选名称与用户活动名称。

第三方依赖、生成产物、.working内历史检查结果和机器日志不作为品牌源文件批量替换。它们包含校验值、真实返回或缓存；需要重新生成的产物通过当前构建产生，不改写历史证据。
