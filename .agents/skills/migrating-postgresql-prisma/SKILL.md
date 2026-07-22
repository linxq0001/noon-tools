---
name: migrating-postgresql-prisma
description: Use when generating, reviewing, testing, or applying PostgreSQL and Prisma schema migrations, constraints, indexes, data backfills, compatibility steps, or recovery plans.
---
# 迁移 PostgreSQL 与 Prisma

先运行 Prisma Schema 验证并检查生成 SQL。仅在本地或隔离测试库执行迁移，验证前滚、约束、索引、回填和应用兼容性；派发 `migration-reviewer`。保存迁移证据与恢复步骤。

生产库禁止 `prisma db push`。生产迁移、回填或数据写入必须说明目标、SQL/迁移名、影响、备份和回滚并获得当前操作的明确确认。
