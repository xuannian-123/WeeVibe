# 团队开发入口

Weego采用单个Taro微信小程序、Next.js Node API、PostgreSQL/Prisma与共享Zod契约。管理者与参与者共用客户端，业务身份与管理权限分开。

- [克隆、配置与本地开发](./development.md)
- [当前架构、已验证内容及后续接通](./architecture.md)
- [团队接手边界、轻量简版和待办](./handoff.md)
- [完整业务规则](../11-首版成局加入与补位规则.md)
- [创建/申请/审批正式接口](../engineering/07-第二轮业务接口交接.md)
- [小程序简版页面交接](../product/05-第二轮小程序页面实施交接.md)

## 五人按功能自主认领

仓库[12张功能任务](https://github.com/xuannian-123/weego/issues)由成员自行认领，一张任务约定一位牵头人，可邀请协助，不预先固定五个岗位。依赖表示整体验收需要接通，不妨碍先按共享契约实现页面或规则。

认领任务 → 对齐接口与文件归属 → 从最新main创建功能分支 → 提交PR → 复核和接入 → 真实验收 → 关闭Issue。共享契约、根配置、锁文件与迁移同时修改前先协调，避免覆盖。

| 任务 | 范围 |
|---|---|
| [WG-01](https://github.com/xuannian-123/weego/issues/1) | 工程、微信身份和部署接通 |
| [WG-02](https://github.com/xuannian-123/weego/issues/2) | 多环节创建、地点填写 |
| [WG-03](https://github.com/xuannian-123/weego/issues/3) | 邀请、报名、整体审批与名单 |
| [WG-04](https://github.com/xuannian-123/weego/issues/4) | 成局、退出、原安排补位 |
| [WG-05](https://github.com/xuannian-123/weego/issues/5) | 发布后变更、保位及重新接受 |
| [WG-06](https://github.com/xuannian-123/weego/issues/6) | 管理权转让 |
| [WG-07](https://github.com/xuannian-123/weego/issues/7) | AI创建、邀请及时间协调 |
| [WG-08](https://github.com/xuannian-123/weego/issues/8) | 图片分享卡 |
| [WG-09](https://github.com/xuannian-123/weego/issues/9) | 应用内待办 |
| [WG-10](https://github.com/xuannian-123/weego/issues/10) | 再约新活动 |
| [WG-11](https://github.com/xuannian-123/weego/issues/11) | 多设备联调及验收 |
| [WG-12](https://github.com/xuannian-123/weego/issues/12) | 现场正式界面和试用改进 |

已有源码、离线通过、真实本机PG通过、云端通过与真机通过分别记录。当前Issue开放不表示没有代码，也不能因编译通过就关闭任务。
