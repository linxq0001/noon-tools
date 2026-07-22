---
name: designing-database-changes
description: Use when a feature changes Prisma models, PostgreSQL relations, constraints, indexes, deletion behavior, data backfills, compatibility, backups, or rollback requirements.
---
# 设计数据库变更

定义模型、字段、类型、关系、唯一约束、索引、外键和级联行为。评估数据量、锁、非空列、默认值、回填顺序和新旧应用版本兼容。设计 expand → migrate/backfill → contract 的安全顺序。

输出 Schema 草案、迁移步骤、验证查询、备份和回滚方案。此阶段不执行迁移。
