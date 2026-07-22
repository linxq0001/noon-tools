---
name: reviewing-fullstack-changes
description: Use after fullstack changes pass basic verification or when review is requested for requirements, API contracts, data safety, security, visual fidelity, deployment risk, and code quality.
---
# 审查全栈改动

派发 `fullstack-reviewer`：先需求与契约，再安全与数据，最后代码质量；严重问题时停止后续阶段。UI 显著变化派发 `visual-checker`，迁移变化派发 `migration-reviewer`，部署变化派发 `deployment-reviewer`。

审查 Agent 只报告有位置和证据的问题。主 Agent 修复后重新验证，并从第一阶段重新审查。
