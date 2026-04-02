// Cloudflare Worker with Google OAuth + 积分用量系统
const FRONTEND_URL = "https://ai-product-content-generator.online";

const PLANS = {
  free: { name: "Free", monthly_credits: 0, price: 0, history_days: 7 },
  starter: { name: "Starter", monthly_credits: 50, price: 5, history_days: 7 },
  pro: { name: "Pro", monthly_credits: 200, price: 15, history_days: 30 },
  business: { name: "Business", monthly_credits: 1000, price: 39, history_days: 90 },
};

const PACKAGES = {
  "Starter Pack": { credits: 10, price: 1 },
  "Small Pack": { credits: 60, price: 5 },
  "Medium Pack": { credits: 200, price: 15 },
  "Large Pack": { credits: 600, price: 39 },
};

// ========== PayPal 配置 ==========
const PAYPAL_BASE = "https://api-m.paypal.com";

async function getPayPalAccessToken(env) {
  const clientId = env.PAYPAL_CLIENT_ID;
  const secret = env.PAYPAL_SECRET;
  const credentials = btoa(clientId + ":" + secret);

  const res = await fetch(PAYPAL_BASE + "/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + credentials,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error("PayPal OAuth failed: " + err);
  }

  const data = await res.json();
  return data.access_token;
}

async function paypalApi(path, method, accessToken, body) {
  const res = await fetch(PAYPAL_BASE + path, {
    method,
    headers: {
      "Authorization": "Bearer " + accessToken,
      "Content-Type": "application/json",
      "PayPal-Request-Id": crypto.randomUUID(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

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

// 模板配置
const CATEGORIES = {
  electronics: {
    name: "Electronics",
    nameEn: "Electronics",
    guidance: "Include key specs, compatibility info, warranty mentions. Focus on technical benefits users care about (speed, battery life, connectivity). Address common concerns like 'is it compatible with...' in bullets."
  },
  clothing: {
    name: "Clothing & Accessories",
    nameEn: "Clothing & Apparel",
    guidance: "Emphasize material quality, fit guidance, sizing tips. Use sensory language (soft, breathable, lightweight). Include styling suggestions and occasions."
  },
  home: {
    name: "Home & Kitchen",
    nameEn: "Home & Kitchen",
    guidance: "Highlight durability, ease of use, space-saving benefits. Mention quality of materials (stainless steel, BPA-free, etc.). Include use cases and room compatibility."
  },
  beauty: {
    name: "Beauty",
    nameEn: "Beauty & Personal Care",
    guidance: "Focus on ingredients, skin type compatibility, expected results. Use before/after language. Address safety concerns (dermatologist tested, hypoallergenic, etc.)."
  },
  sports: {
    name: "Sports & Outdoors",
    nameEn: "Sports & Outdoors",
    guidance: "Emphasize performance benefits, durability in outdoor conditions, versatility. Include skill level recommendations and use scenario specifics."
  },
  baby: {
    name: "Baby & Toys",
    nameEn: "Baby & Toys",
    guidance: "Safety is paramount - highlight certifications, age appropriateness, non-toxic materials. Focus on developmental benefits, durability, easy cleaning."
  },
  food: {
    name: "Food & Beverages",
    nameEn: "Food & Beverages",
    guidance: "Emphasize taste, ingredients, health benefits, dietary compatibility (organic, gluten-free, etc.). Include serving suggestions and storage tips."
  },
  other: {
    name: "Other",
    nameEn: "General",
    guidance: "Focus on core benefits and value proposition. Adapt language to the specific product category."
  }
};

const STYLES = {
  standard: {
    name: "标准Amazon风格",
    guidance: "Classic Amazon listing style. Professional, informative, focus on key features and benefits."
  },
  high_conversion: {
    name: "High Conversion",
    guidance: "Urgency and FOMO-driven. Use power words, create sense of exclusivity, emphasize limited availability or popular demand. Stronger CTAs."
  },
  premium: {
    name: "Premium Luxury",
    guidance: "Sophisticated, aspirational language. Emphasize exclusivity, quality craftsmanship, premium materials. Higher-end vocabulary and tone."
  },
  social: {
    name: "Social Media Friendly",
    guidance: "Short, punchy sentences. Hashtag-friendly phrases. Shareable, viral-worthy copy. Instagram/TikTok style energy."
  }
};

function buildPrompt({ productName, brandName, features, audience, keywords, tone, platform, language, category, style }) {
  const langMap = {
    english: { name: "English", label: "in English" },
    chinese: { name: "Chinese", label: "in Simplified Chinese (简体中文)" },
    japanese: { name: "Japanese", label: "in Japanese (日本語)" },
    korean: { name: "Korean", label: "in Korean (한국어)" },
  };
  const lang = langMap[language] || langMap.english;
  const cat = CATEGORIES[category] || CATEGORIES.other;
  const sty = STYLES[style] || STYLES.standard;

  return `You are an expert eCommerce copywriter specializing in Amazon product listings.

## Your Specialization
Category: ${cat.nameEn} (${cat.name})
Style: ${sty.name}

## Category-Specific Guidelines
${cat.guidance}

## Style Guidelines
${sty.guidance}

## Output Language
Generate a high-converting product listing ${lang.label}.

## 1. Product Title (150-200 characters)
Format: Brand + Core Keywords + Product Type + Key Features
For ${cat.nameEn}: ${cat.guidance.split('.')[0]}

## 2. Five Bullet Points
Each includes: feature, user benefit, emotional appeal, use case
Make bullet points ${sty.name.includes("High Conversion") ? "create urgency and highlight popularity" : "informative and benefit-driven"}

## 3. Product Description (2-3 paragraphs)
Sales-driven language with clear CTA and natural keyword integration
${sty.guidance}

## Requirements:
- High conversion focus, highlight user benefits
- Native ${lang.name}, follow Amazon SEO best practices
- Output ALL content (title, bullet points, description) ${lang.label}
- Include ${cat.nameEn}-specific optimization

Input:
Product: ${productName}
Brand: ${brandName || "N/A"}
Features: ${features}
Target Audience: ${audience || "General"}
Core Keywords: ${keywords || "N/A"}
Tone: ${tone}
Category: ${cat.name}
Style: ${sty.name}

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
      // 前端 URL（域名可能每次部署变化）
      const frontendUrl = url.searchParams.get("frontend_url") || FRONTEND_URL;
      // 把 codeVerifier + state + frontendUrl 一起编码进 state 参数，callback 不需要 cookie
      const stateData = base64urlEncode({ cv: codeVerifier, st: state, fu: frontendUrl });
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
      let frontendUrl = FRONTEND_URL;
      try {
        const dotIdx = fullState.indexOf(".");
        originalState = fullState.substring(0, dotIdx);
        const stateDataStr = fullState.substring(dotIdx + 1);
        const stateData = base64urlDecode(stateDataStr);
        codeVerifier = stateData.cv;
        frontendUrl = stateData.fu || FRONTEND_URL;
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
        const redirectUrl = frontendUrl + "/?auth_callback=1&auth_data=" + authData;

        // 设置 HTTP-Only Cookie（7天过期），作为 localStorage auth_token 的备份
        // 这样即使用户从 PayPal 返回时 localStorage 不可用，后端仍能通过 Cookie 识别用户
        const cookieHeader = `session_token=${sessionToken}; Path=/; Max-Age=${7 * 24 * 60 * 60}; SameSite=Lax`;

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
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Set-Cookie": cookieHeader,
          },
        });

      } catch (err) {
        const detail = err.message || String(err);
        console.error("OAuth error:", err.stack || detail);
        return Response.redirect(frontendUrl + "/?error=oauth_failed&detail=" + encodeURIComponent(detail) + "&auth_callback=1", 302);
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
      const response = {
        authenticated: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          picture: user.picture,
          subscription_plan: user.subscription_plan || "free",
          subscription_status: user.subscription_status || "active",
          created_at: user.created_at ? new Date(user.created_at).toISOString() : null,
          ...usage,
        },
      };

      // 如果请求带 history=true，返回生成历史（按套餐限制天数）
      const url = new URL(request.url);
      if (url.searchParams.get("history") === "true") {
        const page = parseInt(url.searchParams.get("page") || "1");
        const limit = parseInt(url.searchParams.get("limit") || "20");
        const offset = (page - 1) * limit;

        // 根据套餐获取历史记录天数限制
        const userPlan = user.subscription_plan || "free";
        const historyDays = PLANS[userPlan]?.history_days || 7;

        const generationsRes = await env.DB
          .prepare(
            "SELECT id, created_at, product_name, brand_name, features, audience, tone, platform, category, style, generated_title, generated_bullets, generated_description, credits_used FROM generations WHERE user_id = ? AND created_at >= strftime('%s', 'now', '-' || ? || ' days') ORDER BY created_at DESC LIMIT ? OFFSET ?"
          )
          .bind(user.id, historyDays, limit, offset)
          .all();

        response.generations = generationsRes.results || [];
        response.history_days_limit = historyDays;
      }

      return Response.json(response, { headers: corsHeaders() });
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
      const cors = corsHeaders(request.headers.get("Origin"));
      const sessionToken = getSessionToken(request);
      if (!sessionToken) return Response.json({ error: "Unauthorized" }, { status: 401, headers: cors });

      const user = await env.DB
        .prepare("SELECT * FROM users WHERE session_token = ?")
        .bind(sessionToken)
        .first();
      if (!user) return Response.json({ error: "User not found" }, { status: 404, headers: cors });

      const usage = await getUserUsage(env.DB, user.id, user.subscription_plan || "free");
      if (usage.credits_remaining <= 0) {
        return Response.json({
          error: "no_credits",
          message: "积分已用完，请升级套餐或购买积分包",
          credits_remaining: 0,
        }, { status: 402, headers: cors });
      }

      try {
        const body = await request.json();
        const { productName, brandName, features, audience, keywords, tone, platform, language, category, style } = body;
        if (!productName || !features) {
          return Response.json({ error: "Product name and features required" }, { status: 400, headers: cors });
        }

        const prompt = buildPrompt({
          productName,
          brandName,
          features,
          audience,
          keywords,
          tone,
          platform,
          language: language || "english",
          category: category || "other",
          style: style || "standard"
        });
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
            "INSERT INTO generations (id, user_id, product_name, brand_name, features, audience, keywords, tone, platform, category, style, generated_title, generated_bullets, generated_description, credits_used) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)"
          )
          .bind(
            crypto.randomUUID(), user.id, productName, brandName || "", features,
            audience || "", keywords || "", tone || "persuasive", platform || "amazon",
            category || "other", style || "standard",
            result.title || "", JSON.stringify(bullets), result.description || ""
          )
          .run();

        const newUsage = await getUserUsage(env.DB, user.id, user.subscription_plan || "free");

        return Response.json({
          success: true,
          data: { title: result.title, bulletPoints: bullets, description: result.description },
          credits_remaining: newUsage.credits_remaining,
        }, { headers: cors });

      } catch (err) {
        return Response.json({ error: err.message || "Generation failed" }, { status: 500, headers: cors });
      }
    }

    // ========== 套餐列表 ==========

    if (pathname === "/plans" && request.method === "GET") {
      return Response.json({ plans: PLANS, packages: PACKAGES });
    }

    // ========== 模板配置 ==========

    if (pathname === "/api/templates" && request.method === "GET") {
      const categories = Object.entries(CATEGORIES).map(([key, val]) => ({
        id: key,
        name: val.name,
        nameEn: val.nameEn
      }));
      const styles = Object.entries(STYLES).map(([key, val]) => ({
        id: key,
        name: val.name,
        guidance: val.guidance
      }));
      return Response.json({ categories, styles }, { headers: corsHeaders() });
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

    // ========== PayPal 支付 ==========

    // POST /api/paypal/create-order — 创建 PayPal 订单，返回 approvalUrl
    if (pathname === "/api/paypal/create-order" && request.method === "POST") {
      const cors = corsHeaders(request.headers.get("Origin"));
      const sessionToken = getSessionToken(request);
      if (!sessionToken) return Response.json({ error: "Unauthorized" }, { status: 401, headers: cors });

      const user = await env.DB
        .prepare("SELECT * FROM users WHERE session_token = ?")
        .bind(sessionToken)
        .first();
      if (!user) return Response.json({ error: "User not found" }, { status: 404, headers: cors });

      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "Invalid JSON" }, { status: 400, headers: cors });
      }

      const { package_key, frontend_url } = body;
      if (!package_key || !PACKAGES[package_key]) {
        return Response.json({ error: "Invalid package" }, { status: 400, headers: cors });
      }

      const pkg = PACKAGES[package_key];
      const effectiveFrontendUrl = frontend_url || FRONTEND_URL;

      try {
        const accessToken = await getPayPalAccessToken(env);

        const orderRes = await paypalApi("/v2/checkout/orders", "POST", accessToken, {
          intent: "CAPTURE",
          purchase_units: [{
            reference_id: "pkg_" + package_key + "_" + user.id,
            description: "AI Product Content Generator - " + package_key + " (" + pkg.credits + " credits)",
            amount: {
              currency_code: "USD",
              value: pkg.price.toFixed(2),
            },
          }],
          application_context: {
            brand_name: "AI Product Content Generator",
            landing_page: "BILLING",
            user_action: "PAY_NOW",
            return_url: effectiveFrontendUrl + "/?paypal_return=1",
            cancel_url: effectiveFrontendUrl + "/?paypal_cancel=1",
          },
        });

        const orderData = await orderRes.json();

        if (!orderRes.ok) {
          console.error("PayPal create order error:", JSON.stringify(orderData));
          return Response.json({ error: "PayPal order creation failed" }, { status: 500, headers: cors });
        }

        // 找到 approval URL
        const approvalUrl = orderData.links?.find((l) => l.rel === "approve")?.href;
        if (!approvalUrl) {
          return Response.json({ error: "No approval URL from PayPal" }, { status: 500, headers: cors });
        }

        return Response.json({
          orderId: orderData.id,
          approvalUrl,
        }, { headers: cors });

      } catch (err) {
        console.error("PayPal error:", err.message);
        return Response.json({ error: err.message || "PayPal error" }, { status: 500, headers: cors });
      }
    }

    // POST /api/paypal/capture-order — 捕获 PayPal 订单（用户从 PayPal 返回后前端调用）
    if (pathname === "/api/paypal/capture-order" && request.method === "POST") {
      const cors = corsHeaders(request.headers.get("Origin"));
      const sessionToken = getSessionToken(request);
      if (!sessionToken) return Response.json({ error: "Unauthorized" }, { status: 401, headers: cors });

      const user = await env.DB
        .prepare("SELECT * FROM users WHERE session_token = ?")
        .bind(sessionToken)
        .first();
      if (!user) return Response.json({ error: "User not found" }, { status: 404, headers: cors });

      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "Invalid JSON" }, { status: 400, headers: cors });
      }

      const { orderId } = body;
      if (!orderId) {
        return Response.json({ error: "orderId required" }, { status: 400, headers: cors });
      }

      try {
        const accessToken = await getPayPalAccessToken(env);

        // 捕获订单
        const captureRes = await paypalApi("/v2/checkout/orders/" + orderId + "/capture", "POST", accessToken);
        const captureData = await captureRes.json();

        if (!captureRes.ok) {
          console.error("PayPal capture error:", JSON.stringify(captureData));
          return Response.json({ error: "Payment capture failed" }, { status: 500, headers: cors });
        }

        // 检查支付状态
        if (captureData.status !== "COMPLETED") {
          return Response.json({ error: "Payment not completed: " + captureData.status }, { status: 400, headers: cors });
        }

        // 从 reference_id 解析 package_key 和 user_id
        const refId = captureData.purchase_units?.[0]?.reference_id || "";
        const match = refId.match(/^pkg_(.+)_(.+)$/);
        if (!match || match[2] !== user.id) {
          return Response.json({ error: "Package mismatch" }, { status: 400, headers: cors });
        }

        const package_key = match[1];
        if (!PACKAGES[package_key]) {
          return Response.json({ error: "Invalid package" }, { status: 400, headers: cors });
        }

        const pkg = PACKAGES[package_key];

        // 记录购买交易
        await env.DB
          .prepare(
            "INSERT INTO transactions (id, user_id, type, description, credits_added) VALUES (?, ?, 'package', ?, ?)"
          )
          .bind(crypto.randomUUID(), user.id, `PayPal ${package_key}`, pkg.credits)
          .run();

        const newUsage = await getUserUsage(env.DB, user.id, user.subscription_plan || "free");

        return Response.json({
          success: true,
          package: package_key,
          credits_added: pkg.credits,
          new_balance: newUsage.credits_remaining,
          package_remaining: newUsage.package_remaining,
          monthly_remaining: newUsage.monthly_remaining,
          credits_remaining: newUsage.credits_remaining,
        }, { headers: cors });

      } catch (err) {
        console.error("PayPal capture error:", err.message);
        return Response.json({ error: err.message || "Capture failed" }, { status: 500, headers: cors });
      }
    }

    // ========== PayPal 订阅 ==========

    // POST /api/paypal/create-subscription — 创建月度订阅
    if (pathname === "/api/paypal/create-subscription" && request.method === "POST") {
      const cors = corsHeaders(request.headers.get("Origin"));
      const sessionToken = getSessionToken(request);
      if (!sessionToken) return Response.json({ error: "Unauthorized" }, { status: 401, headers: cors });

      const user = await env.DB
        .prepare("SELECT * FROM users WHERE session_token = ?")
        .bind(sessionToken)
        .first();
      if (!user) return Response.json({ error: "User not found" }, { status: 404, headers: cors });

      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "Invalid JSON" }, { status: 400, headers: cors });
      }

      const { plan_key, frontend_url } = body;
      if (!plan_key || !PLANS[plan_key] || PLANS[plan_key].price === 0) {
        return Response.json({ error: "Invalid plan" }, { status: 400, headers: cors });
      }

      const plan = PLANS[plan_key];
      const effectiveFrontendUrl = frontend_url || FRONTEND_URL;

      try {
        const accessToken = await getPayPalAccessToken(env);

        // 创建 product
        const productRes = await paypalApi("/v1/catalogs/products", "POST", accessToken, {
          name: "AI Product Content Generator - " + plan.name,
          description: "Monthly subscription - " + plan.name + " Plan",
          type: "SERVICE",
        });
        const productData = await productRes.json();
        if (!productRes.ok) {
          console.error("PayPal create product error:", JSON.stringify(productData));
          return Response.json({ error: "Failed to create product" }, { status: 500, headers: cors });
        }
        const productId = productData.id;

        // 创建 billing plan
        const billingPlanRes = await paypalApi("/v1/billing/plans", "POST", accessToken, {
          product_id: productId,
          name: plan.name + " Monthly Plan",
          description: plan.name + " Plan - Monthly subscription - " + plan.monthly_credits + " credits/month",
          type: "INFINITE",
          payment_definitions: [{
            name: "Monthly Subscription",
            type: "REGULAR",
            frequency: "MONTH",
            frequency_interval: 1,
            amount: {
              currency_code: "USD",
              value: plan.price.toFixed(2),
            },
          }],
          billing_cycles: [{
            frequency: {
              interval_unit: "MONTH",
              interval_count: 1,
            },
            tenure_type: "REGULAR",
            sequence: 1,
            total_cycles: 0,
            pricing_scheme: {
              fixed_price: {
                value: plan.price.toFixed(2),
                currency_code: "USD",
              },
            },
          }],
          payment_preferences: {
            auto_bill_amount: "YES",
            initial_fail_action: "CONTINUE",
            return_url: effectiveFrontendUrl + "/profile?subscription_return=1&plan=" + plan_key,
            cancel_url: effectiveFrontendUrl + "/profile?subscription_cancel=1&plan=" + plan_key,
          },
        });
        const billingPlanData = await billingPlanRes.json();
        if (!billingPlanRes.ok) {
          console.error("PayPal create plan error:", JSON.stringify(billingPlanData));
          return Response.json({ error: "Failed to create billing plan: " + JSON.stringify(billingPlanData) }, { status: 500, headers: cors });
        }
        const billingPlanId = billingPlanData.id;

        // 如果 plan 状态不是 ACTIVE，则激活
        if (billingPlanData.status !== "ACTIVE") {
          const activateRes = await paypalApi("/v1/billing/plans/" + billingPlanId + "/activate", "POST", accessToken);
          if (!activateRes.ok) {
            console.error("PayPal activate plan error:", await activateRes.text());
            return Response.json({ error: "Failed to activate plan" }, { status: 500, headers: cors });
          }
        }

        // 创建订阅
        const subRes = await paypalApi("/v1/billing/subscriptions", "POST", accessToken, {
          plan_id: billingPlanId,
          subscriber: {
            email_address: user.email,
          },
          custom_id: "sub_" + plan_key + "_" + user.id,
          application_context: {
            brand_name: "AI Product Content Generator",
            user_action: "SUBSCRIBE_NOW",
            return_url: effectiveFrontendUrl + "/profile?subscription_return=1&plan=" + plan_key,
            cancel_url: effectiveFrontendUrl + "/profile?subscription_cancel=1&plan=" + plan_key,
          },
        });
        const subData = await subRes.json();

        if (!subRes.ok) {
          console.error("PayPal create subscription error:", JSON.stringify(subData));
          return Response.json({ error: "Failed to create subscription" }, { status: 500, headers: cors });
        }

        // 找到 approval URL
        const approvalUrl = subData.links?.find((l) => l.rel === "approve")?.href;
        if (!approvalUrl) {
          return Response.json({ error: "No approval URL from PayPal" }, { status: 500, headers: cors });
        }

        return Response.json({
          subscriptionId: subData.id,
          approvalUrl,
        }, { headers: cors });

      } catch (err) {
        console.error("PayPal subscription error:", err.message);
        return Response.json({ error: err.message || "Subscription error" }, { status: 500, headers: cors });
      }
    }

    // POST /api/paypal/capture-subscription — 捕获订阅（用户从 PayPal 返回后前端调用）
    if (pathname === "/api/paypal/capture-subscription" && request.method === "POST") {
      const cors = corsHeaders(request.headers.get("Origin"));
      const authHeader = request.headers.get("Authorization");
      console.log("capture-subscription auth header:", authHeader);
      const sessionToken = getSessionToken(request);
      console.log("sessionToken extracted:", sessionToken);

      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "Invalid JSON" }, { status: 400, headers: cors });
      }

      const { subscriptionId, plan_key, user_id } = body;
      if (!subscriptionId || !plan_key) {
        return Response.json({ error: "subscriptionId and plan_key required" }, { status: 400, headers: cors });
      }

      if (!PLANS[plan_key] || PLANS[plan_key].price === 0) {
        return Response.json({ error: "Invalid plan" }, { status: 400, headers: cors });
      }

      // 优先用 session_token 查找用户
      let user = null;
      if (sessionToken) {
        user = await env.DB
          .prepare("SELECT * FROM users WHERE session_token = ?")
          .bind(sessionToken)
          .first();
        console.log("user from session_token:", user?.id, user?.email);
      }

      // 如果 session_token 找不到用户（比如用户重新登录后 token 变化），尝试用 user_id 查找
      // user_id 来自 localStorage（登录时存储），在订阅创建时已经被验证过
      if (!user && user_id) {
        console.log("session_token not found, trying user_id:", user_id);
        user = await env.DB
          .prepare("SELECT * FROM users WHERE id = ?")
          .bind(user_id)
          .first();
        console.log("user from user_id:", user?.id, user?.email);
      }

      if (!user) {
        return Response.json({ error: "User not found" }, { status: 404, headers: cors });
      }

      try {
        const accessToken = await getPayPalAccessToken(env);

        // 查询订阅状态
        const subRes = await paypalApi("/v1/billing/subscriptions/" + subscriptionId, "GET", accessToken);
        const subData = await subRes.json();

        if (!subRes.ok) {
          console.error("PayPal get subscription error:", JSON.stringify(subData));
          return Response.json({ error: "Failed to get subscription" }, { status: 500, headers: cors });
        }

        // 检查 custom_id 防伪校验（custom_id 格式: sub_{plan_key}_{user_id}）
        const expectedCustomId = "sub_" + plan_key + "_" + user.id;
        if (subData.custom_id !== expectedCustomId) {
          // 如果 user_id 不匹配，说明订阅不是这个用户的
          return Response.json({ error: "Subscription mismatch" }, { status: 400, headers: cors });
        }

        // 检查状态
        if (!["ACTIVE", "APPROVED", "ACTIVATED", "CREATED"].includes(subData.status)) {
          return Response.json({ error: "Subscription not active: " + subData.status }, { status: 400, headers: cors });
        }

        // 更新用户套餐（幂等：即使重复调用也成功）
        await env.DB
          .prepare("UPDATE users SET subscription_plan = ?, subscription_status = 'active' WHERE id = ?")
          .bind(plan_key, user.id)
          .run();

        // 记录首月订阅交易
        await env.DB
          .prepare(
            "INSERT INTO transactions (id, user_id, type, description, credits_added) VALUES (?, ?, 'subscription', ?, ?)"
          )
          .bind(crypto.randomUUID(), user.id, `PayPal ${plan_key} 订阅激活`, PLANS[plan_key].monthly_credits)
          .run();

        const newUsage = await getUserUsage(env.DB, user.id, plan_key);

        return Response.json({
          success: true,
          plan: plan_key,
          monthly_credits: newUsage.monthly_credits,
          monthly_remaining: newUsage.monthly_remaining,
          credits_remaining: newUsage.credits_remaining,
        }, { headers: cors });

      } catch (err) {
        console.error("PayPal capture subscription error:", err.message);
        return Response.json({ error: err.message || "Capture failed" }, { status: 500, headers: cors });
      }
    }

    // POST /api/paypal/webhook — 接收 PayPal Webhook 事件
    if (pathname === "/api/paypal/webhook" && request.method === "POST") {
      const cors = corsHeaders(request.headers.get("Origin"));
      const body = await request.text();
      const headers = {};
      request.headers.forEach((v, k) => headers[k] = v);

      console.log("PayPal webhook received:", headers["paypal-transmission-id"]);

      try {
        const event = JSON.parse(body);
        console.log("Webhook event type:", event.event_type);

        // 订阅激活 webhook — 自动处理激活（不依赖前端 redirect）
        if (event.event_type === "BILLING.SUBSCRIPTION.ACTIVATED") {
          const customId = event.resource?.custom_id; // 格式: sub_planKey_userId
          if (customId) {
            const parts = customId.split("_");
            const planKey = parts[1]; // starter, pro, business
            const userId = parts[2];

            if (userId && planKey && PLANS[planKey] && PLANS[planKey].price > 0) {
              await env.DB
                .prepare("UPDATE users SET subscription_plan = ?, subscription_status = 'active' WHERE id = ?")
                .bind(planKey, userId)
                .run();
              console.log("User", userId, "upgraded to", planKey, "via webhook");
            }
          }
          return Response.json({ received: true }, { headers: cors });
        }

        // 订阅取消 webhook
        if (event.event_type === "BILLING.SUBSCRIPTION.CANCELLED") {
          const customId = event.resource?.custom_id;
          if (customId) {
            const parts = customId.split("_");
            const planKey = parts[1];
            const userId = parts[2];
            if (userId) {
              await env.DB
                .prepare("UPDATE users SET subscription_plan = 'free' WHERE id = ?")
                .bind(userId)
                .run();
              console.log("User", userId, "downgraded to free via webhook");
            }
          }
          return Response.json({ received: true }, { headers: cors });
        }

        return Response.json({ received: true }, { headers: cors });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 400, headers: cors });
      }
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
