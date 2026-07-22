# noon-tools

## 启动命令

```bash
pnpm install
# 如果本机没有 pnpm，也可以用：
npm install
```

### Next.js 页面

```bash
pnpm dev:next
# 或：
npm run dev:next
```

- 访问：`http://localhost:3000`
- Noon 工作台：`http://localhost:3000/noon-workbench`
- 安全边界：Next 服务仅绑定 `127.0.0.1`，只用于本机单用户操作。不要改为局域网或公网监听；如需多人或远程使用，必须先增加身份认证和店铺级授权。

生产构建：

```bash
pnpm build:next
pnpm start:next
# 或：
npm run build:next
npm run start:next
```

### 旧版本地 UI

```bash
pnpm ui
# 或：
npm run ui
```

- 访问：`http://localhost:4173`
- 旧版 Noon 工作台：`http://localhost:4173/#noon-workbench`

如果 Next 页面出现缓存导致的 `Internal Server Error`，先停止 `pnpm dev:next`，再执行：

```bash
rm -rf .next
pnpm dev:next
# 或：
npm run dev:next
```
