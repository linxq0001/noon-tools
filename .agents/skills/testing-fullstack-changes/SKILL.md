---
name: testing-fullstack-changes
description: Use after fullstack implementation or fixes and before completion claims, when affected frontend, API, database, authorization, migration, build, and end-to-end paths need fresh evidence.
---
# 验证全栈改动

调用 `verification-before-completion`。从项目脚本识别并运行受影响范围的 typecheck、lint、build、unit、integration、migration、security 和 E2E；缺少工具时不安装，记录原因与风险。

前端用浏览器验证关键交互和视口；API 检查验证、错误、鉴权和越权；数据库验证 Schema、迁移、约束与回填。全栈关键功能至少跑通一次浏览器 → API → 数据库 → 页面。失败则调试、修复并用同一检查重验。
