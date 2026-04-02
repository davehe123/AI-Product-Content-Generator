# 部署记录

| 日期 | 项目 | 版本/Commit | 部署目标 | 状态 | 备注 |
|------|------|------------|---------|------|------|
| 2026-03-30 | AI-Product-Content-Generator | - | Cloudflare Pages + Worker | 进行中 | 域名激活中 |
| 2026-03-28 | AI-Product-Content-Generator | - | Cloudflare Worker | 完成 | PayPal 支付上线 |
| 2026-03-26 | AI-Product-Content-Generator | - | Cloudflare Pages + Worker | 完成 | MVP 上线 |

---

## 项目文件路径

### AI-Product-Content-Generator
```
本地路径: /root/.openclaw/workspace/project/ai-product-content-generator
GitHub:   https://github.com/davehe123/AI-Product-Content-Generator

前端文件:
  - src/app/page.tsx           # 首页
  - src/app/api/              # API 路由
  - .vercel/output/static/    # 构建输出

后端文件:
  - workers/worker.js          # Cloudflare Worker
  - workers/wrangler.toml      # Worker 配置

部署命令:
  - 前端: wrangler pages deploy .vercel/output/static --project-name=ai-product-content-generator
  - 后端: wrangler deploy workers/worker.js --name ai-product-content-generator-api
```

---

## Cloudflare 资源

| 资源类型 | 名称 | 地址/ID |
|---------|------|---------|
| Pages 前端 | ai-product-content-generator | https://ai-product-content-generator.online ✅ |
| Worker 后端 | ai-product-content-generator-api | ai-product-content-generator-api.deforde159.workers.dev |
| D1 数据库 | ai_product_db | 88ba6100-a8ec-4bf2-8524-268c3402501e |
| 自定义域名 | ai-product-content-generator.online | ✅ 已激活 |
