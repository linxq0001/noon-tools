---
name: designing-system-architecture
description: Use when a fullstack feature needs module boundaries, request and data flow, server responsibilities, caching, consistency, asynchronous work, or a decision about service separation.
---
# 设计系统架构

默认模块化单体。定义模块职责、入口、领域逻辑、数据访问、外部服务和依赖方向；说明 Server Component、Server Action、Route Handler 与后台任务边界。明确事务、缓存失效、并发和一致性策略。

只有独立扩缩容、运行时隔离或组织边界得到证据支持时才拆服务。输出架构图式描述、数据流、风险和决策理由。
