# 获准独立环境后：发布前最小只读核对（文档草稿，未执行）

本节补充现有开发预检，不是部署或数据库访问授权。只有维护者已指定独立 API、数据库和 schema，并授权检查，才由获准操作者执行；目标不明、无法确认权限或发现异常时停止。不要拿共享演示库作探针，也不重试此前受阻的执行器路径。

## 1. 先绑定目标与同一份产物

记录获准的环境标识、部署包 SHA256、对应源码清单/提交及客户端构建公开配置。新增包基于上游同一个 commit 持续修改，**仅相同上游 commit 不足以证明新包相同**；用交付回执 SHA256 和源码清单核对真正准备部署的版本，不从文件名推断。

- 小程序公开配置来自 `apps/miniprogram/config/index.ts` 中的 `TARO_APP_*`，在构建进程显式设置；服务端配置由维护者安全提供给目标运行环境，本地 Next 使用 `apps/web/.env.local`，项目根 `.env.example` 只是字段示例。
- Prisma CLI 必须取得经核对的**同一目标** `DATABASE_URL`；不能假定它自动加载 Next 的 `.env.local`。不把连接串或秘密填进聊天、命令历史、ZIP、前端或完整日志，也不复制旧服务全部环境变量。
- 先确认可信登录链路也指向这份 API；仅切换客户端地址不等于旧云登录函数会签发给新后端。未获准修改旧函数时保持原状。

## 2. 迁移前先查状态，不把迁移当探针

以下命令在解压包的 `project/`（源码根）执行，前提是运行时、依赖和受控进程环境已准备好。该命令会连接获准数据库读取迁移状态，不是离线检查；**本轮未执行**。

```sh
pnpm exec prisma migrate status --schema prisma/schema.prisma
```

本包应核对 `prisma/migrations/` 的全部 **10** 条，而不是只补第9/10条。尤其：

- 第9条：`20261026141500_requirement_response_version`
- 第10条：`20261026191500_management_handover`

非零退出可能表示尚有待应用、历史分歧、失败迁移或连接问题；先识别原因，不能自动继续 `migrate deploy`、`resolve`、`reset` 或 `db push`。状态显示已同步也不保证实际 schema 没有被手工改动、索引有效或业务并发已通过。CLI可能打印数据库名/schema/host或连接错误；完整输出仅在授权环境本地受控保存，对外交付只留脱敏状态/摘要，不粘贴完整stdout或错误堆栈。

## 3. 只读核对关键对象，不读取业务行

本段使用 **psql 客户端语法**（包含反斜线命令），不是可原样粘贴到任意图形 SQL 编辑器的纯 SQL。在操作者已通过安全方式连接获准数据库后，先单独执行以下只读查询，并在本地核对数据库名、当前默认 schema 和 search_path；与获准目标不符或无法确认则停止，不继续下一块。不要粘贴连接串或要求将秘密 URL 交给他人。

```sql
SELECT pg_catalog.current_database() AS database_name,
       pg_catalog.current_schema() AS default_schema,
       pg_catalog.current_setting('search_path') AS search_path;
```

核对后，在**同一个 psql 连接**输入唯一已获准的目标 schema 名（不是连接串，不包含额外手加的 SQL 引号），并将它绑定到所有对象查询；该值须与 Prisma 的目标 schema 一致。下面不采用默认 public，不从 search_path 搜索同名表。`:"target_schema"` 安全引用标识符、`:'target_schema'` 安全引用字符串，表 OID 使用 `%I` 构造同一全限定名；特殊字符由引用机制处理，不做原样 SQL 拼接。[psql 官方变量引用规则](https://www.postgresql.org/docs/18/app-psql.html#APP-PSQL-INTERPOLATION)、[format 标识符引用](https://www.postgresql.org/docs/18/functions-string.html#FUNCTIONS-STRING-FORMAT)。

若迁移表不存在或没有读权限，记为“尚不能核验”，不自动创建或提升权限。这里只选迁移元数据和明确的系统目录，不查用户答卷、身份或管理业务行；任何错误停止后续检查并 ROLLBACK，不将不完整输出当作通过。

```sql
\set ON_ERROR_STOP on
\prompt 'Approved target schema only: ' target_schema
BEGIN READ ONLY;

SELECT migration_name, checksum, finished_at, rolled_back_at
FROM :"target_schema"."_prisma_migrations"
ORDER BY migration_name, started_at;

SELECT data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = :'target_schema'
  AND table_name = 'RequirementSubmission' AND column_name = 'responseVersion';

SELECT conname, convalidated, pg_catalog.pg_get_constraintdef(oid) AS definition
FROM pg_catalog.pg_constraint
WHERE conrelid = pg_catalog.to_regclass(
        pg_catalog.format('%I.%I', :'target_schema', 'RequirementSubmission'))
  AND conname = 'RequirementSubmission_responseVersion_positive';

SELECT pg_catalog.to_regclass(
         pg_catalog.format('%I.%I', :'target_schema', 'ManagementHandover')) AS handover_table;

SELECT idx.relname, i.indisunique, i.indisvalid, i.indisready,
       pg_catalog.pg_get_indexdef(i.indexrelid) AS definition,
       pg_catalog.pg_get_expr(i.indpred, i.indrelid) AS predicate
FROM pg_catalog.pg_index AS i
JOIN pg_catalog.pg_class AS idx ON idx.oid = i.indexrelid
WHERE i.indrelid = pg_catalog.to_regclass(
        pg_catalog.format('%I.%I', :'target_schema', 'ManagementHandover'))
  AND idx.relname = 'ManagementHandover_one_pending_per_activity';

ROLLBACK;
```

逐项对照本包迁移文件，而不是只看有没有一行：成功迁移记录需 `finished_at` 非空且 `rolled_back_at` 为空，checksum 与本包对应 SQL 的 SHA256 一致；历史失败/回滚记录需维护者解释，不自行清除。答卷列应为非空 integer、默认1，正数约束已验证；交接表应存在，指定索引为有效且 ready 的 unique，键为 `activityId`、谓词为 `status = pending`（数据库可显示等价类型转换）。缺失、定义不符或读权限不足均阻止宣布“迁移齐全”。这些是第9/10条的关键门槛，**不是整个 schema、其余约束、索引性能或真实事务并发的完整验收**。

## 4. 再分层验证与决定是否继续

当前 `/api/v1/health` 的 `version` 固定为 `0.0.1`；`/api/v1/ready` 仅执行 `SELECT 1`。因此 health200只表示进程存活，ready200只表示当前连接可查询，**都不证明第9/10条已应用、对应新包正在运行、微信已登录或业务成功**。版本匹配依赖前述产物/部署记录，迁移依赖元数据与对象核查；cloud-http还必须检查 envelope 的内部状态，不能只看外层200。

发现缺失后，只有另行确认备份、目标与写入授权，且隔离旧不兼容 writer，才由维护者按现有部署流程处理；本节不执行 DDL。切换后按晨间验收做真实身份、答卷CAS、管理交接及取消的正反向/竞争验收，不能用只读检查代替。

源码回退不等于数据库回滚，不 drop 新列/表/历史，不恢复原创建者管理权，不重置当前 `currentManagerId`/`managementRevision`。旧无条件答卷 writer 不得重新开放；回退具体限制继续以现有 `requirement-answer-cas.md` 和 `management-handover.md` 为准。
