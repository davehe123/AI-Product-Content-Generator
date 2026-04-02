# 更新记录

## 2026-03-30

### AI-Product-Content-Generator
- **更新内容**:
  - ✅ 自定义域名 `ai-product-content-generator.online` 配置完成
  - ✅ Worker FRONTEND_URL 更新为新域名
  - ✅ 积分充值后自动刷新（调用 checkAuth 从服务器重新获取用户数据）
  - ✅ 历史记录按套餐限制天数（Free/Starter 7天 / Pro 30天 / Business 90天）
  - ✅ 历史记录 SQL 修复（datetime → strftime）
  - ✅ PayPal 沙箱→正式环境切换（api-m.sandbox.paypal.com → api-m.paypal.com）
  - 添加飞书文档推送功能
  - 12条 LinkedIn求职 Prompts 整理
- **前端**: https://ai-product-content-generator.online
- **Worker**: https://ai-product-content-generator-api.deforde159.workers.dev
- **备注**: PayPal 跳转问题已解决（不再走 .pages.dev 短域名）

---

## 2026-03-28

### AI-Product-Content-Generator
- **更新内容**:
  - PayPal 沙箱支付接入完成
  - Webhook 订阅激活功能
  - OAuth callback session_token cookie 修复
- **备注**: 完成主要支付功能

---

## 2026-03-26

### AI-Product-Content-Generator
- **更新内容**:
  - Google OAuth 登录
  - D1 用户体系
  - 积分扣减逻辑
- **备注**: MVP 版本上线

