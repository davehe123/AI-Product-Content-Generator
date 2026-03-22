// Cloudflare Worker with Google OAuth
// Supports: /api/generate, /auth/google, /auth/callback, /auth/me, /auth/logout

// 简单的内存 session store (生产环境建议用 KV)
const sessions = new Map();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // CORS 处理
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Cookie",
        },
      });
    }

    // ========== OAuth 路由 ==========

    // 1. Google 登录入口
    if (pathname === "/auth/google" && request.method === "GET") {
      const state = generateState();
      const codeVerifier = generateCodeVerifier();
      
      // 存储 state 和 code verifier
      sessions.set(state, { codeVerifier, createdAt: Date.now() });
      
      // 10分钟后过期
      setTimeout(() => sessions.delete(state), 10 * 60 * 1000);

      const params = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: `${url.origin}/auth/callback`,
        response_type: "code",
        scope: "openid email profile",
        state: state,
        code_challenge: await generateCodeChallenge(codeVerifier),
        code_challenge_method: "S256",
      });

      return Response.redirect(
        `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
        302
      );
    }

    // 2. Google 回调
    if (pathname === "/auth/callback" && request.method === "GET") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        return Response.json({ error: "OAuth error: " + error }, { status: 400 });
      }

      if (!code || !state) {
        return Response.json({ error: "Missing code or state" }, { status: 400 });
      }

      const sessionData = sessions.get(state);
      if (!sessionData) {
        return Response.json({ error: "Invalid state" }, { status: 400 });
      }
      sessions.delete(state);

      try {
        // 用 code 换 access_token
        const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            code: code,
            grant_type: "authorization_code",
            redirect_uri: `${url.origin}/auth/callback",
            code_verifier: sessionData.codeVerifier,
          }),
        });

        const tokenData = await tokenResponse.json();

        if (!tokenData.access_token) {
          throw new Error("Failed to get access token");
        }

        // 获取用户信息
        const userResponse = await fetch(
          "https://www.googleapis.com/oauth2/v2/userinfo",
          {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
          }
        );
        const googleUser = await userResponse.json();

        // 生成 session token
        const sessionToken = generateSessionToken();
        
        // 存入数据库
        const userId = crypto.randomUUID();
        
        // 检查用户是否已存在
        const existingUser = await env.ai_product_db
          .prepare("SELECT id FROM users WHERE google_id = ?")
          .bind(googleUser.id)
          .first();

        if (existingUser) {
          // 更新最后登录时间
          await env.ai_product_db
            .prepare("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE google_id = ?")
            .bind(googleUser.id)
            .run();
          
          const user = await env.ai_product_db
            .prepare("SELECT * FROM users WHERE google_id = ?")
            .bind(googleUser.id)
            .first();
          
          sessions.set(sessionToken, { user, createdAt: Date.now() });
        } else {
          // 创建新用户
          await env.ai_product_db
            .prepare(
              "INSERT INTO users (id, email, name, picture, google_id, created_at, last_login) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            )
            .bind(userId, googleUser.email, googleUser.name || "", googleUser.picture || "", googleUser.id)
            .run();
          
          const user = {
            id: userId,
            email: googleUser.email,
            name: googleUser.name || "",
            picture: googleUser.picture || "",
            subscription_status: "free",
            subscription_plan: null,
          };
          sessions.set(sessionToken, { user, createdAt: Date.now() });
        }

        // 设置 cookie 并重定向到前端
        const response = new Response(null, {
          status: 302,
          headers: {
            Location: "/",
            "Set-Cookie": `session=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 60 * 60}`,
          },
        });

        return response;
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500 });
      }
    }

    // 3. 获取当前用户
    if (pathname === "/auth/me" && request.method === "GET") {
      const cookieHeader = request.headers.get("Cookie");
      const sessionToken = getSessionToken(cookieHeader);

      if (!sessionToken) {
        return Response.json({ authenticated: false, user: null });
      }

      const sessionData = sessions.get(sessionToken);
      if (!sessionData) {
        return Response.json({ authenticated: false, user: null });
      }

      return Response.json({
        authenticated: true,
        user: sessionData.user,
      });
    }

    // 4. 登出
    if (pathname === "/auth/logout" && request.method === "POST") {
      const cookieHeader = request.headers.get("Cookie");
      const sessionToken = getSessionToken(cookieHeader);

      if (sessionToken) {
        sessions.delete(sessionToken);
      }

      return new Response(null, {
        status: 302,
        headers: {
          Location: "/",
          "Set-Cookie": "session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
        },
      });
    }

    // ========== 原有的 API 路由 ==========

    // Handle CORS for API
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Only handle POST requests to /api/generate
    if (request.method !== "POST" || !pathname.includes("/api/generate")) {
      return new Response("Not Found", { status: 404 });
    }

    try {
      const body = await request.json();
      const { productName, brandName, features, audience, keywords, tone, platform } = body;

      if (!productName || !features) {
        return Response.json(
          { error: "Product name and features are required" },
          { status: 400, headers: corsHeaders }
        );
      }

      const prompt = `You are an expert eCommerce copywriter specializing in Amazon product listings.

Generate a high-converting product listing with:

## 1. Product Title (150-200 characters)
- Format: Brand + Core Keywords + Product Type + Features + Quantity
- Include core keywords for SEO
- Conversion-focused wording

## 2. Five Bullet Points
Each bullet should include:
- Product feature
- User benefit
- Emotional appeal
- Use case

## 3. Product Description (2-3 paragraphs)
- Sales-driven language
- Clear Call-to-Action
- Natural keyword integration

Requirements:
- High conversion focus
- Highlight user benefits, not just features
- Native English expression
- Natural keyword placement
- Follow Amazon SEO best practices

Input:
Product: ${productName}
Brand: ${brandName || 'N/A'}
Features: ${features}
Target Audience: ${audience || 'General'}
Core Keywords: ${keywords || 'N/A'}
Tone: ${tone}

Please output in the following JSON format:
{
  "title": "...",
  "bulletPoints": ["...", "...", "...", "...", "..."],
  "description": "..."
}`;

      // Call DeepSeek API
      const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            {
              role: "system",
              content: "You are an expert Amazon product listing copywriter. Generate high-converting, SEO-optimized content."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          response_format: { type: "json_object" },
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || "DeepSeek API error");
      }

      const data = await response.json();
      const responseContent = data.choices[0]?.message?.content;

      if (!responseContent) {
        throw new Error("No response from AI");
      }

      const parsedResult = JSON.parse(responseContent);

      const bulletPoints = Array.isArray(parsedResult.bulletPoints) 
        ? parsedResult.bulletPoints.slice(0, 5) 
        : [];

      return Response.json({
        success: true,
        data: {
          title: parsedResult.title,
          bulletPoints,
          description: parsedResult.description
        }
      }, { headers: corsHeaders });

    } catch (error) {
      return Response.json(
        { error: error.message || "Failed to generate content" },
        { status: 500, headers: corsHeaders }
      );
    }
  },
};

// ========== 辅助函数 ==========

function generateState() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function generateSessionToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

function getSessionToken(cookieHeader) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/session=([^;]+)/);
  return match ? match[1] : null;
}
