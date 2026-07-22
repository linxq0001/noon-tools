---
name: planning-fullstack-implementation
description: Use when requirements, architecture, UI, API, and database decisions are clear and a fullstack change needs minimal ordered implementation steps with verification evidence.
---
# 规划全栈实现

较大任务调用 `writing-plans`，简单任务使用短计划。只包含实际涉及层，通常按契约/Schema → 数据库 → 服务端 → API → 前端 → 测试 → 安全 → 部署排序。列出确切文件、职责、依赖和每步验证。

禁止未授权依赖、无关重构、提前微服务化和把生产执行混入普通开发步骤。
