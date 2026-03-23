# AI-Product-Content-Generator 开发进度

## 最后更新：2026-03-23 22:02

---

## 当前架构

```
用户浏览器
    │
    ▼
前端 Next.js ──────────────────────────────────────► Cloudflare Pages
https://c1285faa.ai-product-content-generator.pages.dev   (会随每次部署变)
    │
    │ fetch() 调用
    ▼
后端 Cloudflare Worker ────────────────────────────► Google OAuth / DeepSeek API
https://ai-product-content-generator-api.deforde159.workers.dev  (固定不变)
    │
    └── D1 Database (ai_product_db) — 用户/积分/历史
```

---

## 已完成功能

### ✅ 认证系统
- Google OAuth 2.0 登录（popup 模式）
- 注册赠送 3 次免费积分
- Bearer Token 认证（localStorage 存储）
- 登出功能

### ✅ 用户体系
- users 表：用户信息 + 订阅状态
- transactions 表：积分变动记录（注册赠送/购买/扣减）
- generations 表：生成历史记录
- `/auth/me` — 获取当前用户 + 实时积分
- `/user/usage` — 用量详情

### ✅ 用量控制
- 每次生成扣 1 次积分
- 积分不足返回 402，前端弹窗引导升级
- `/plans` — 套餐列表 API
- `/user/package` — 积分包购买 API

### ✅ 前端
- 积分进度条展示
- 升级弹窗
- 生成结果复制功能

---

## 套餐配置

| 方案 | 月额度 | 价格 |
|------|--------|------|
| Free | 0 | $0 |
| Starter | 50次/月 | $5/月 |
| Pro | 200次/月 | $15/月 |
| Business | 1000次/月 | $39/月 |

## 积分包

| 包 | 价格 | 积分 |
|----|------|------|
| 体验包 | $1 | 10次 |
| 小包 | $5 | 60次 |
| 中包 | $15 | 200次 |
| 大包 | $39 | 600次 |

---

## 待完成功能

- [ ] 订阅支付接入（PayPal/Stripe）
- [ ] 积分包购买页面 + 支付
- [ ] 个人中心页面
- [ ] 固定前端域名（避免每次部署 URL 变化）
- [ ] KV 持久化 session（当前存内存，Worker 重启会丢）
- [ ] OAuth 登录模式优化（popup vs 直接跳转，待定）

---

## 数据库（D1）

- **数据库名**: ai_product_db
- **Region**: APAC
- **Database ID**: 88ba6100-a8ec-4bf2-8524-268c3402501e

**表结构**:
```sql
users (id, email, name, picture, google_id, subscription_status, last_login)
transactions (id, user_id, type, description, credits_added, credits_deducted, amount_paid)
generations (id, user_id, product_name, brand_name, features, audience, keywords, tone, platform, generated_title, generated_bullets, generated_description, credits_used)
```

---

## 已知问题

### OAuth popup 登录不稳定
- popup 授权完成后跳转回主页面时，有时仍显示 oauth_failed
- 原因：URL 同时有 `error` 和 `auth_callback` 参数时，error 处理覆盖了成功状态
- 已修复参数优先级，但仍有偶发问题
- 备选方案：改用直接跳转模式（整页跳 Google，授权完再跳回）

### Cloudflare Pages URL 每次部署随机变化
- 解决：OAuth callback 改用 Worker 固定域名
- 待办：给 Pages 绑定自定义域名

### Session 存内存，Worker 重启会丢失
- 解决：接入 Cloudflare KV 持久化 session
- 当前 workaround：登录态存在 localStorage，Worker 重启后需重新登录

---

## 关键教训

1. **字段名必须与数据库一致** — `subscription_tier` vs `subscription_plan` 导致所有新用户 INSERT 失败
2. **Cloudflare Pages 每次部署 URL 随机变化** — OAuth callback 改为 Worker 固定域名
3. **postMessage 跨域 popup 不稳定** — 改用 URL 参数回传 auth_data
4. **Next.js 15.5.2 API Routes 在 Cloudflare Pages 全部 500** — 前后端分离，API 独立部署到 Workers
