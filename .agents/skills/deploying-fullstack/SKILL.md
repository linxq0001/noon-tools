---
name: deploying-fullstack
description: Use when preparing or performing fullstack deployment, cloud resource changes, environment variables, migration sequencing, health checks, rollback, or post-release verification.
---
# 部署全栈应用

先准备目标环境、构建产物、环境变量名称、秘密引用、迁移顺序、资源变化、健康检查、发布后验证和回滚步骤，派发 `deployment-reviewer`。不得把真实秘密写入文档或命令日志。

任何生产部署、回滚、云资源、DNS、权限、密钥、生产迁移或数据写操作都要为当前具体操作单独确认。执行后验证健康、关键路径和监控；失败时按已审查方案回滚。
