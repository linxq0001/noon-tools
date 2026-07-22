---
name: designing-api-contracts
description: Use when frontend and backend need an agreed API or Server Action contract covering routes, schemas, errors, authentication, authorization, pagination, concurrency, or idempotency.
---
# 设计 API 契约

先定义再实现。记录路由与方法、请求参数、响应 Schema、状态码、稳定错误码、身份与权限、分页筛选排序、并发冲突和幂等键。区分客户端可见信息与服务端内部错误。

输出前后端共享的契约和正反例验收清单；契约变化必须检查现有调用方兼容性。
