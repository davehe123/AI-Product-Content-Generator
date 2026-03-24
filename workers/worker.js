// Cloudflare Worker with Google OAuth + 积分用量系统
const FRONTEND_URL = "https://ai-product-content-generator.pages.dev";

const PLANS = {
  free: { name: "Free", monthly_credits: 0, price: 0 },
  starter: { name: "Starter", monthly_credits: 50, price: 5 },
  pro: { name: "Pro", monthly_credits: 200, price: 15 },
  business: { name: "Business", monthly_credits: 1000, price: 39 },
};

const PACKAGES = {
  "体验包": { credits: 10, price: 1 },
  "小包": { credits: 60, price: 5 },
  "中包": { credits: 200, price: 15 },
  "大包": { credits: 600, price: 39 },
};

// ========== 辅助函数 ==========

// 内存 session store（Cloudflare Worker 多实例不共享，但 auth callback 在同一实例走完）
const sessions = new Map();

function corsHeaders(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };
}

function getSessionToken(request) {
  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.substring(7);
  const cookies = request.headers.get("Cookie") || "";
  const m = cookies.match(/session_token=([^;]+)/);
  return m ? m[1] : null;
}

function base64urlEncode(data) {
  return btoa(JSON.stringify(data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64urlDecode(str) {
  // Add padding
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return JSON.parse(atob(str));
}

function generateState() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

function generateCodeVerifier() {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function generateSessionToken() {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function getUserUsage(db, userId, tier) {
  const usedRes = await db
    .prepare("SELECT COUNT(*) as count FROM generations WHERE user_id = ?")
    .bind(userId)
    .first();
  const monthlyUsed = usedRes?.count || 0;

  const pkgRes = await db
    .prepare(
      "SELECT COALESCE(SUM(credits_added), 0) - (SELECT COALESCE(SUM(credits_deducted), 0) FROM transactions WHERE user_id = ? AND type = 'usage') as remaining FROM transactions WHERE user_id = ? AND type IN ('package', 'bonus')"
    )
    .bind(userId, userId)
    .first();
  const packageRemaining = Math.max(0, pkgRes?.remaining || 0);

  const plan = PLANS[tier] || PLANS.free;
  const monthlyRemaining = Math.max(0, plan.monthly_credits - monthlyUsed);

  return {
    monthly_credits: plan.monthly_credits,
    monthly_used: monthlyUsed,
    monthly_remaining: monthlyRemaining,
    package_remaining: packageRemaining,
    credits_remaining: monthlyRemaining + packageRemaining,
    plan: tier,
  };
}

function buildPrompt({ productName, brandName, features, audience, keywords, tone, platform }) {
  return `You are an expert eCommerce copywriter specializing in Amazon product listings.

Generate a high-converting product listing with:

## 1. Product Title (150-200 characters)
Format: Brand + Core Keywords + Product Type + Features

## 2. Five Bullet Points
Each includes: feature, user benefit, emotional appeal, use case

## 3. Product Description (2-3 paragraphs)
Sales-driven language with clear CTA and natural keyword integration

Requirements:
- High conversion focus, highlight user benefits
- Native English, follow Amazon SEO best practices

Input:
Product: ${productName}
Brand: ${brandName || "N/A"}
Features: ${features}
Target Audience: ${audience || "General"}
Core Keywords: ${keywords || "N/A"}
Tone: ${tone}

Output JSON format:
{
  "title": "...",
  "bulletPoints": ["...", "...", "...", "...", "..."],
  "description": "..."
}`;
}

// ========== Worker Main ==========

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request.headers.get("Origin")) });
    }

    // ========== OAuth - Step 1: 跳转 Google ==========

    if (pathname === "/auth/google" && request.method === "GET") {
      const state = generateState();
      const codeVerifier = generateCodeVerifier();
      // 把 codeVerifier + state 一起编码进 state 参数，callback 不需要 cookie
      const stateData = base64urlEncode({ cv: codeVerifier, st: state });
      const fullState = state + "." + stateData;

      const params = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: url.origin + "/auth/callback",
        response_type: "code",
        scope: "openid email profile",
        state: fullState,
        code_challenge: await generateCodeChallenge(codeVerifier),
        code_challenge_method: "S256",
      });

      return Response.redirect(
        "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString(),
        302
      );
    }

    // ========== OAuth - Step 2: Google 回调 ==========

    if (pathname === "/auth/callback" && request.method === "GET") {
      const code = url.searchParams.get("code");
      const errorParam = url.searchParams.get("error");
      const fullState = url.searchParams.get("state");

      if (errorParam) {
        return Response.redirect(FRONTEND_URL + "/?error=" + encodeURIComponent(errorParam) + "&auth_callback=1", 302);
      }
      if (!code || !fullState) {
        return Response.redirect(FRONTEND_URL + "/?error=missing_params&auth_callback=1", 302);
      }

      let codeVerifier = null;
      let originalState = null;
      try {
        const dotIdx = fullState.indexOf(".");
        originalState = fullState.substring(0, dotIdx);
        const stateDataStr = fullState.substring(dotIdx + 1);
        const stateData = base64urlDecode(stateDataStr);
        codeVerifier = stateData.cv;
        // 校验 state 匹配
        if (stateData.st !== originalState) throw new Error("state mismatch");
      } catch (err) {
        console.error("Invalid state:", err.message);
        return Response.redirect(FRONTEND_URL + "/?error=invalid_state&auth_callback=1", 302);
      }

      try {
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            code,
            grant_type: "authorization_code",
            redirect_uri: url.origin + "/auth/callback",
            code_verifier: codeVerifier,
          }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) throw new Error("No access token: " + JSON.stringify(tokenData));

        // 获取 Google 用户信息
        const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { Authorization: "Bearer " + tokenData.access_token },
        });
        const googleUser = await userRes.json();
        if (!googleUser.email) throw new Error("No email from Google");

        // 查找或创建用户
        let user = await env.DB
          .prepare("SELECT * FROM users WHERE google_id = ?")
          .bind(googleUser.id)
          .first();

        if (!user) {
          const userId = crypto.randomUUID();
          const sessionToken = generateSessionToken();
          await env.DB
            .prepare(
              "INSERT INTO users (id, email, name, picture, google_id, subscription_status, last_login, session_token) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)"
            )
            .bind(userId, googleUser.email, googleUser.name || "", googleUser.picture || "", googleUser.id, Date.now(), sessionToken)
            .run();

          await env.DB
            .prepare(
              "INSERT INTO transactions (id, user_id, type, description, credits_added) VALUES (?, ?, 'bonus', '注册赠送', 3)"
            )
            .bind(crypto.randomUUID(), userId)
            .run();

          user = { id: userId, email: googleUser.email, name: googleUser.name || "", subscription_plan: "free", session_token: sessionToken };
        } else {
          // 更新最后登录时间
          await env.DB
            .prepare("UPDATE users SET last_login = ? WHERE id = ?")
            .bind(Date.now(), user.id)
            .run();
        }

        // 生成新的 session token
        const sessionToken = generateSessionToken();
        await env.DB
          .prepare("UPDATE users SET session_token = ? WHERE id = ?")
          .bind(sessionToken, user.id)
          .run();

        // 把 token 通过 URL 返回给前端
        const authData = base64urlEncode({ token: sessionToken, userId: user.id, email: user.email, name: user.name });
        const redirectUrl = FRONTEND_URL + "/?auth_callback=1&auth_data=" + authData;

        const html = `<!DOCTYPE html>
<html>
<head><title>Login Success</title></head>
<body style="font-family:Arial,sans-serif;text-align:center;padding-top:80px;background:#f0f9ff;">
<p style="font-size:24px;margin-bottom:12px;">✅ Login Successful!</p>
<p id="msg" style="color:#666;">Redirecting to app...</p>
<script>
  // Redirect to frontend so it can process auth_data, then close popup after short delay
  setTimeout(function() {
    window.location.replace(${JSON.stringify(redirectUrl)});
  }, 500);
</script>
</body>
</html>`;

        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });

      } catch (err) {
        const detail = err.message || String(err);
        console.error("OAuth error:", err.stack || detail);
        return Response.redirect(FRONTEND_URL + "/?error=oauth_failed&detail=" + encodeURIComponent(detail) + "&auth_callback=1", 302);
      }
    }

    // ========== 当前用户 ==========

    if (pathname === "/auth/me" && request.method === "GET") {
      const sessionToken = getSessionToken(request);
      if (!sessionToken) return Response.json({ authenticated: false, user: null }, { headers: corsHeaders() });

      const user = await env.DB
        .prepare("SELECT * FROM users WHERE session_token = ?")
        .bind(sessionToken)
        .first();
      if (!user) return Response.json({ authenticated: false, user: null }, { headers: corsHeaders() });

      const usage = await getUserUsage(env.DB, user.id, user.subscription_plan || "free");
      return Response.json({
        authenticated: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          picture: user.picture,
          subscription_plan: user.subscription_plan || "free",
          subscription_status: user.subscription_status || "active",
          ...usage,
        },
      }, { headers: corsHeaders() });
    }

    // ========== 登出 ==========

    if (pathname === "/auth/logout" && request.method === "POST") {
      const sessionToken = getSessionToken(request);
      if (sessionToken) {
        await env.DB.prepare("UPDATE users SET session_token = NULL WHERE session_token = ?").bind(sessionToken).run();
      }
      return Response.json({ success: true }, { headers: corsHeaders() });
    }

    // ========== 用量查询 ==========

    if (pathname === "/user/usage" && request.method === "GET") {
      const sessionToken = getSessionToken(request);
      if (!sessionToken) return Response.json({ error: "Unauthorized" }, { status: 401 });

      const user = await env.DB
        .prepare("SELECT * FROM users WHERE session_token = ?")
        .bind(sessionToken)
        .first();
      if (!user) return Response.json({ error: "User not found" }, { status: 404 });

      const usage = await getUserUsage(env.DB, user.id, user.subscription_plan || "free");
      return Response.json({ usage });
    }

    // ========== 生成内容 ==========

    if (pathname === "/api/generate" && request.method === "POST") {
      const sessionToken = getSessionToken(request);
      if (!sessionToken) return Response.json({ error: "Unauthorized" }, { status: 401 });

      const user = await env.DB
        .prepare("SELECT * FROM users WHERE session_token = ?")
        .bind(sessionToken)
        .first();
      if (!user) return Response.json({ error: "User not found" }, { status: 404 });

      const usage = await getUserUsage(env.DB, user.id, user.subscription_plan || "free");
      if (usage.credits_remaining <= 0) {
        return Response.json({
          error: "no_credits",
          message: "积分已用完，请升级套餐或购买积分包",
          credits_remaining: 0,
        }, { status: 402 });
      }

      try {
        const body = await request.json();
        const { productName, brandName, features, audience, keywords, tone, platform } = body;
        if (!productName || !features) {
          return Response.json({ error: "Product name and features required" }, { status: 400 });
        }

        const prompt = buildPrompt({ productName, brandName, features, audience, keywords, tone, platform });
        const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + env.DEEPSEEK_API_KEY,
          },
          body: JSON.stringify({
            model: "deepseek-chat",
            messages: [
              { role: "system", content: "You are an expert Amazon product listing copywriter." },
              { role: "user", content: prompt },
            ],
            response_format: { type: "json_object" },
            temperature: 0.7,
          }),
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error?.message || "AI API error");
        }

        const data = await response.json();
        const content = data.choices[0]?.message?.content;
        if (!content) throw new Error("No response from AI");

        const result = JSON.parse(content);
        const bullets = Array.isArray(result.bulletPoints) ? result.bulletPoints.slice(0, 5) : [];

        // 扣积分
        await env.DB
          .prepare("INSERT INTO transactions (id, user_id, type, description, credits_deducted) VALUES (?, ?, 'usage', '生成扣减', 1)")
          .bind(crypto.randomUUID(), user.id)
          .run();

        // 记录历史
        await env.DB
          .prepare(
            "INSERT INTO generations (id, user_id, product_name, brand_name, features, audience, keywords, tone, platform, generated_title, generated_bullets, generated_description, credits_used) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)"
          )
          .bind(
            crypto.randomUUID(), user.id, productName, brandName || "", features,
            audience || "", keywords || "", tone || "persuasive", platform || "amazon",
            result.title || "", JSON.stringify(bullets), result.description || ""
          )
          .run();

        const newUsage = await getUserUsage(env.DB, user.id, user.subscription_plan || "free");

        return Response.json({
          success: true,
          data: { title: result.title, bulletPoints: bullets, description: result.description },
          credits_remaining: newUsage.credits_remaining,
        });

      } catch (err) {
        return Response.json({ error: err.message || "Generation failed" }, { status: 500 });
      }
    }

    // ========== 套餐列表 ==========

    if (pathname === "/plans" && request.method === "GET") {
      return Response.json({ plans: PLANS, packages: PACKAGES });
    }

    // ========== 模拟支付 ==========

    if (pathname === "/api/fake-pay" && request.method === "POST") {
      const sessionToken = getSessionToken(request);
      if (!sessionToken) return Response.json({ error: "Unauthorized" }, { status: 401 });

      const user = await env.DB
        .prepare("SELECT * FROM users WHERE session_token = ?")
        .bind(sessionToken)
        .first();
      if (!user) return Response.json({ error: "User not found" }, { status: 404 });

      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "Invalid JSON" }, { status: 400 });
      }

      const { package_key } = body;
      if (!package_key || !PACKAGES[package_key]) {
        return Response.json({ error: "Invalid package" }, { status: 400 });
      }

      const pkg = PACKAGES[package_key];

      // 模拟支付处理延迟（1-2秒）
      await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 1000));

      // 记录购买交易
      await env.DB
        .prepare(
          "INSERT INTO transactions (id, user_id, type, description, credits_added) VALUES (?, ?, 'package', ?, ?)"
        )
        .bind(crypto.randomUUID(), user.id, `购买 ${package_key}`, pkg.credits)
        .run();

      // 获取更新后的用量
      const newUsage = await getUserUsage(env.DB, user.id, user.subscription_plan || "free");

      return Response.json({
        success: true,
        package: package_key,
        credits_added: pkg.credits,
        new_balance: newUsage.credits_remaining,
        package_remaining: newUsage.package_remaining,
        monthly_remaining: newUsage.monthly_remaining,
        credits_remaining: newUsage.credits_remaining,
      });
    }

    // ========== 测试 D1 ==========

    if (pathname === "/test/d1" && request.method === "GET") {
      try {
        const result = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        return Response.json({ ok: true, tables: result.results });
      } catch (err) {
        return Response.json({ ok: false, error: err.message });
      }
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
};
