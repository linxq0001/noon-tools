---
name: debugging-fullstack
description: Use when failures cross browser, React, API, Server Actions, services, Prisma, PostgreSQL, authentication, external integrations, jobs, or deployment environments.
---
# 调试全栈问题

优先调用 `systematic-debugging`。记录环境、输入、预期、实际和稳定复现证据，沿浏览器 → 网络 → API → 服务 → 数据库/外部服务 → 响应链追踪。一次验证一个假设，根因必须解释全部主要现象。

不能复现时列出缺失条件并停止猜测。修复前建立失败检查，实施最小修复，再用同一检查和直接相关场景重验。
