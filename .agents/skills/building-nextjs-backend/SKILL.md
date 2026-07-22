---
name: building-nextjs-backend
description: Use when implementing Next.js Route Handlers, Server Actions, service or domain logic, Prisma access, authentication, authorization, background work, storage, or external integrations.
---
# 开发 Next.js 后端

优先调用 `test-driven-development`。入口只负责解析、验证、鉴权和响应；业务规则放服务层，数据访问集中使用 Prisma。服务端同时执行身份认证和资源级授权，验证所有外部输入，使用稳定错误码，日志默认脱敏。

为重试、并发和外部副作用实现已确认的幂等策略。真实邮件、短信、支付和付费服务调用需要单独确认。
