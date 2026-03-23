# AI-Product-Content-Generator 开发文档

## 项目概述

- **GitHub**: https://github.com/davehe123/AI-Product-Content-Generator
- **本地路径**: `/root/.openclaw/workspace/project/ai-product-content-generator`
- **技术栈**: Next.js 15.5.2 + Tailwind CSS 4 + Cloudflare Pages + Cloudflare Workers
- **功能**: AI 生成 Amazon 商品Listing（标题 + 要点 + 描述）

---

## 部署架构

### 当前最终架构（问题修复后）

```
用户浏览器
    │
    ▼
前端 Next.js ───────────────────────────────────────► Cloudflare Pages
https://08f49b12.ai-product-content-generator.pages.dev   (托管静态页面)
    │
    │ fetch() 调用
    ▼
后端 Cloudflare Worker ◄───────────────────────────────► Google OAuth / DeepSeek API
https://ai-product-content-generator-api.deforde159.workers.dev
    - /auth/google         (发起 Google 登录)
    - /auth/callback       (OAuth 回调)
    - /auth/me             (获取当前用户)
    - /auth/logout         (登出)
    - /api/generate        (AI 生成内容)
```

### 之前的架构（有问题）

```
用户浏览器
    │
    ▼
Cloudflare Pages ──────────────────────────────────────► Pages Edge Functions (API Routes)
https://ai-product-content-generator.pages.dev             /api/auth/google 等
                                                              │
                                                              ▼
                                                         Internal Server Error ❌
```

---

## 核心问题：Next.js 15.5.2 API Routes 在 Cloudflare Pages 上全部 500

### 问题现象

访问任意 API 路由均返回 `Internal Server Error`：
- `/api/auth/google` → 500
- `/api/auth/me` → 500
- `/api/generate` → 500
- `/api/test-simple` → 500（最简测试路由也报错）

### 排查过程

1. **确认网络层面**：curl 测试确认是 500 而非网络问题
2. **Cloudflare 实时日志**：未获得有效错误堆栈
3. **PKCE 代码检查**：发现 PKCE 实现有误（`code_challenge_method=plain` 但 Google 要求 `S256`）
4. **修复 PKCE 后问题依旧**：说明问题不是 OAuth 代码，而是更底层的兼容性问题
5. **升级 `@cloudflare/next-on-pages`**：从 1.13.10 升级到 1.13.16，问题依旧
6. **确认 `nodejs_compat` flag 已配置**：在 `wrangler.toml` 和 Cloudflare Dashboard 两处均已确认
7. **结论**：Next.js 15.5.2 App Router 的 Edge Runtime 与 Cloudflare Pages v8-worker 存在兼容性问题，所有 API 均无法正常运行

### 解决路径

最终采用**前后端分离架构**：前端保留在 Cloudflare Pages（只做静态托管），后端 API 独立部署到 Cloudflare Workers。

---

## 技术问题与修复

### 1. PKCE 实现错误

**文件**: `src/app/api/auth/google/route.ts`

**问题**: 用了 `code_challenge_method=plain`，即 `code_challenge` 直接填随机字符串，但 Google 只接受 `S256`（SHA256 摘要）。

**修复**: 正确计算 `SHA256(code_verifier)` 并 Base64URL 编码：

```typescript
async function generateCodeChallenge(codeVerifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  let base64 = btoa(String.fromCharCode(...hashArray));
  base64 = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return base64;
}
```

### 2. Worker 代码中 esbuild 解析错误

**文件**: `workers/worker.js`

**问题**: esbuild 在解析模板字符串时报错 `Expected "}" but found "Bearer"`，原因是在 `export default` 对象内部的模板字符串中嵌套了 `${}` 语法。

**受影响的行**:
```javascript
// 错误
headers: { Authorization: `Bearer ${tokenData.access_token}` },
redirect_uri: `${url.origin}/auth/callback`,

// 修复
headers: { Authorization: "Bearer " + tokenData.access_token },
redirect_uri: url.origin + "/auth/callback",
```

### 3. TypeScript 类型错误

**文件**: `src/app/page.tsx`

**问题**: `getAuthHeaders()` 返回的类型 `{ Authorization: string; } | {}` 无法赋值给 `RequestInit['headers']`。

**修复**:
```typescript
function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}
```

---

## 认证流程设计

### Cookie vs Bearer Token

由于前端（`.pages.dev`）和后端 Worker（`.workers.dev`）域名不同，Cookie 无法跨域传递。改用 **Bearer Token + localStorage** 方案：

1. 用户点击登录 → Worker 弹出窗口跳转到 Google OAuth
2. Google 授权后回调 Worker 的 `/auth/callback`
3. Worker 生成 session token，返回一个 HTML 页面
4. HTML 页面通过 `postMessage` 将 token 发送给主页面，并存储到 `localStorage`
5. 之后所有 API 请求带上 `Authorization: Bearer <token>` Header

### 登录流程代码变更

```typescript
// 旧版（相对路径，调用 Pages Edge Functions）
window.location.href = "/api/auth/google";

// 新版（绝对路径，调用 Worker）
const popup = window.open(`${WORKER_URL}/auth/google`, "google_login", "...");

// 旧版认证检查
const res = await fetch("/api/auth/me");

// 新版认证检查
const res = await fetch(`${WORKER_URL}/auth/me`, {
  headers: { Authorization: `Bearer ${token}` },
});
```

---

## 环境变量配置

### Worker 环境变量（必需）

| 变量名 | 值 | 设置方式 |
|--------|-----|---------|
| `GOOGLE_CLIENT_ID` | `713210082248-...apps.googleusercontent.com` | `wrangler pages secret put` |
| `GOOGLE_CLIENT_SECRET` | `GOCSPX-2rqL22-...` | `wrangler pages secret put` |
| `DEEPSEEK_API_KEY` | `sk-9ada497fb48a406a8c3302e9475f15dd` | `.env.local`（本地构建用）|

### Google OAuth 回调 URL

**重要**：Google Cloud Console 中配置的回调 URL 必须与 Worker 部署的 origin 完全匹配：

```
https://ai-product-content-generator-api.deforde159.workers.dev/auth/callback
```

注意：不是 `.pages.dev` 域名，而是 Workers 专属的 `.workers.dev` 域名。

### 构建命令

```bash
# 构建 Next.js 前端
npm run cf-build

# 部署前端到 Cloudflare Pages
npx wrangler pages deploy .vercel/output/static \
  --project-name=ai-product-content-generator

# 部署后端 Worker（需要先设置环境变量）
npx wrangler deploy workers/worker.js \
  --name ai-product-content-generator-api \
  --compatibility-flag=nodejs_compat \
  --keep-vars \
  --no-bundle \
  --var "GOOGLE_CLIENT_ID:xxx" \
  --var "GOOGLE_CLIENT_SECRET:xxx"
```

---

## Cloudflare 相关操作

### 关键资源

- **Cloudflare Dashboard**: https://dash.cloudflare.com
- **Pages 项目**: `ai-product-content-generator`
- **Workers 项目**: `ai-product-content-generator-api`
- **Workers 触发器 URL**: `https://ai-product-content-generator-api.deforde159.workers.dev`

### 查看 Workers 日志

```bash
npx wrangler pages deployment tail --project-name=ai-product-content-generator
```

### 设置环境变量（Pages Secrets）

```bash
npx wrangler pages secret put GOOGLE_CLIENT_ID --project-name=ai-product-content-generator
npx wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name=ai-product-content-generator
```

---

## Next.js 版本降级参考

如果未来需要降级 Next.js 版本以改善兼容性，可参考以下路径：

```bash
# 查看可用版本
npm show next versions --json | grep -E "15\.[0-9]"

# 降级（如果需要）
npm install next@15.3.0 --legacy-peer-deps
```

同时需要确认 `@cloudflare/next-on-pages` 版本与 Next.js 版本兼容。

---

## 遗留问题

1. **Next.js Pages Edge Functions 500 问题**：未找到根本原因，疑似 Next.js 15.5.2 与 Cloudflare Pages v8-worker 的兼容性问题。当前绕过方式使用独立 Workers。
2. **用户登录状态未持久化**：当前 session 存储在 Worker 内存中（`Map`），重启 Worker 后所有用户登录状态会失效。生产环境应使用 Cloudflare KV 存储。
3. **D1 数据库未启用**：Worker 代码中预留了 D1 数据库逻辑（用户持久化），但未实际创建 D1 实例。

---

## 相关文件

| 文件 | 说明 |
|------|------|
| `workers/worker.js` | Cloudflare Worker（后端 API） |
| `workers/wrangler.toml` | Worker 配置文件 |
| `src/app/page.tsx` | 前端主页（调用 Worker API） |
| `src/app/api/auth/google/route.ts` | 旧版 OAuth 入口（已不再使用） |
| `.vercel/output/static/` | `npm run cf-build` 构建产物 |
