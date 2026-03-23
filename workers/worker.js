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

// 内存 session store（生产环境建议用 KV）
const sessions = new Map();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // ========== OAuth ==========

    if (pathname === "/auth/google" && request.method === "GET") {
      const state = generateState();
      const codeVerifier = generateCodeVerifier();
      sessions.set(state, { codeVerifier, createdAt: Date.now() });
      setTimeout(() => sessions.delete(state), 10 * 60 * 1000);

      const params = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: url.origin + "/auth/callback",
        response_type: "code",
        scope: "openid email profile",
        state,
        code_challenge: await generateCodeChallenge(codeVerifier),
        code_challenge_method: "S256",
      });

      return Response.redirect(
        "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString(),
        302
      );
    }

    if (pathname === "/auth/callback" && request.method === "GET") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        return Response.redirect(FRONTEND_URL + "/?error=" + encodeURIComponent(error), 302);
      }
      if (!code || !state) {
        return Response.redirect(FRONTEND_URL + "/?error=missing_params", 302);
      }

      const sessionData = sessions.get(state);
      if (!sessionData) {
        return Response.redirect(FRONTEND_URL + "/?error=invalid_state", 302);
      }
      sessions.delete(state);

      try {
        // 换 token
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            code,
            grant_type: "authorization_code",
            redirect_uri: url.origin + "/auth/callback",
            code_verifier: sessionData.codeVerifier,
          }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) throw new Error("No access token");

        // 获取用户信息
        const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { Authorization: "Bearer " + tokenData.access_token },
        });
        const googleUser = await userRes.json();

        // 查找或创建用户
        let user = await env.DB
          .prepare("SELECT * FROM users WHERE google_id = ?")
          .bind(googleUser.id)
          .first();

        if (!user) {
          const userId = crypto.randomUUID();
          await env.DB
            .prepare(
              "INSERT INTO users (id, email, name, picture, google_id, subscription_status, last_login) VALUES (?, ?, ?, ?, ?, 'active', ?)"
            )
            .bind(userId, googleUser.email, googleUser.name || "", googleUser.picture || "", googleUser.id, Date.now())
            .run();

          // 注册赠送3次积分
          await env.DB
            .prepare(
              "INSERT INTO transactions (id, user_id, type, description, credits_added) VALUES (?, ?, 'bonus', '注册赠送', 3)"
            )
            .bind(crypto.randomUUID(), userId)
            .run();

          user = await env.DB
            .prepare("SELECT * FROM users WHERE id = ?")
            .bind(userId)
            .first();
        } else {
          await env.DB
            .prepare("UPDATE users SET last_login = ? WHERE id = ?")
            .bind(Date.now(), user.id)
            .run();
        }

        // 生成 session token
        const sessionToken = generateSessionToken();
        sessions.set(sessionToken, { userId: user.id, createdAt: Date.now() });

        // 通过 URL 参数回传
        const authData = btoa(JSON.stringify({ token: sessionToken, user }))
          .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
        const redirectUrl = FRONTEND_URL + "/?auth_callback=1&auth_data=" + authData;

        const html = `<!DOCTYPE html>
<html><head><meta http-equiv="refresh" content="0;url=${redirectUrl}"></head>
<body><script>window.location.href='${redirectUrl}';setTimeout(()=>window.close(),500);</script>
<p>登录成功，正在跳转...</p></body></html>`;

        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });

      } catch (err) {
        console.error("OAuth callback error:", err.message);
        return Response.redirect(FRONTEND_URL + "/?error=oauth_failed", 302);
      }
    }

    if (pathname === "/auth/me" && request.method === "GET") {
      const sessionToken = getBearerToken(request);
      if (!sessionToken) return Response.json({ authenticated: false, user: null });
      const sessionData = sessions.get(sessionToken);
      if (!sessionData) return Response.json({ authenticated: false, user: null });

      const user = await env.DB
        .prepare("SELECT * FROM users WHERE id = ?")
        .bind(sessionData.userId)
        .first();
      if (!user) return Response.json({ authenticated: false, user: null });

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
      });
    }

    if (pathname === "/auth/logout" && request.method === "POST") {
      const sessionToken = getBearerToken(request);
      if (sessionToken) sessions.delete(sessionToken);
      return Response.json({ success: true });
    }

    // ========== 用量 ==========

    if (pathname === "/user/usage" && request.method === "GET") {
      const sessionToken = getBearerToken(request);
      if (!sessionToken) return Response.json({ error: "Unauthorized" }, { status: 401 });
      const sessionData = sessions.get(sessionToken);
      if (!sessionData) return Response.json({ error: "Invalid session" }, { status: 401 });

      const user = await env.DB
        .prepare("SELECT * FROM users WHERE id = ?")
        .bind(sessionData.userId)
        .first();
      if (!user) return Response.json({ error: "User not found" }, { status: 404 });

      const usage = await getUserUsage(env.DB, user.id, user.subscription_plan || "free");
      return Response.json({ usage });
    }

    // ========== 生成 ==========

    if (pathname === "/api/generate" && request.method === "POST") {
      const sessionToken = getBearerToken(request);
      if (!sessionToken) return Response.json({ error: "Unauthorized" }, { status: 401 });
      const sessionData = sessions.get(sessionToken);
      if (!sessionData) return Response.json({ error: "Invalid session" }, { status: 401 });

      const user = await env.DB
        .prepare("SELECT * FROM users WHERE id = ?")
        .bind(sessionData.userId)
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

    // ========== 积分包 ==========

    if (pathname === "/user/package" && request.method === "POST") {
      const sessionToken = getBearerToken(request);
      if (!sessionToken) return Response.json({ error: "Unauthorized" }, { status: 401 });
      const sessionData = sessions.get(sessionToken);
      if (!sessionData) return Response.json({ error: "Invalid session" }, { status: 401 });

      const body = await request.json();
      const { package_key } = body;
      const pkg = PACKAGES[package_key];
      if (!pkg) return Response.json({ error: "Invalid package" }, { status: 400 });

      await env.DB
        .prepare(
          "INSERT INTO transactions (id, user_id, type, description, credits_added, amount_paid) VALUES (?, ?, 'package', ?, ?, ?)"
        )
        .bind(crypto.randomUUID(), sessionData.userId, package_key, pkg.credits, pkg.price)
        .run();

      return Response.json({ success: true, credits_added: pkg.credits });
    }

    // ========== 套餐列表 ==========

    if (pathname === "/plans" && request.method === "GET") {
      return Response.json({ plans: PLANS, packages: PACKAGES });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
};

// ========== 核心用量逻辑 ==========

async function getUserUsage(db, userId, tier) {
  const now = Math.floor(Date.now() / 1000);

  // 本月使用次数
  const usedRes = await db
    .prepare("SELECT COUNT(*) as count FROM generations WHERE user_id = ?")
    .bind(userId)
    .first();
  const monthlyUsed = usedRes?.count || 0;

  // 积分包总剩余
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

// ========== 辅助函数 ==========

function getBearerToken(request) {
  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.substring(7);
  const cookie = request.headers.get("Cookie");
  if (cookie) {
    const m = cookie.match(/session=([^;]+)/);
    return m ? m[1] : null;
  }
  return null;
}

function generateState() {
  const a = new Uint8Array(32);
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
