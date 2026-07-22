---
name: building-nextjs-frontend
description: Use when implementing an approved frontend slice in a Next.js and TypeScript application from confirmed UI, API contracts, states, and responsive behavior.
---
# 开发 Next.js 前端

优先调用 `test-driven-development`。按已确认设计和 API 契约实现最小改动，复用现有组件与 token。默认 Server Component，只在浏览器 API、交互状态或客户端 Hook 必需时建立 Client 边界。实现加载、空、错误、禁用和响应式状态。

不得读取服务端密钥、复制服务端规则到客户端、安装未授权依赖或修改无关代码。完成后进入全栈验证。
