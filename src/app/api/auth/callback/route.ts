import { NextRequest, NextResponse } from "next/server";

export const runtime = 'edge';

// 简单的 session token 生成
function generateSessionToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b: number) => b.toString(16).padStart(2, "0")).join("");
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return new NextResponse(null, {
      status: 302,
      headers: {
        Location: "/?error=" + encodeURIComponent(error),
      },
    });
  }

  if (!code || !state) {
    return new NextResponse(null, {
      status: 302,
      headers: {
        Location: "/?error=missing_params",
      },
    });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://ai-product-content-generator.pages.dev';

  try {
    // 用 code 换 access_token
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId!,
        client_secret: clientSecret!,
        code: code,
        grant_type: "authorization_code",
        redirect_uri: `${baseUrl}/api/auth/callback`,
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

    // 注意：在 Edge Runtime 中无法直接访问 D1
    // 需要通过 KV 或者把用户信息存在 cookie 中
    // 这里简化处理，直接把用户信息加密后存在 cookie
    
    const userData = JSON.stringify({
      id: googleUser.id,
      email: googleUser.email,
      name: googleUser.name || "",
      picture: googleUser.picture || "",
    });

    // Base64 encode (简单处理，生产环境应该加密)
    const encodedUserData = btoa(userData);

    // 重定向到首页，并设置 cookie
    const response = new NextResponse(null, {
      status: 302,
      headers: {
        Location: "/",
        "Set-Cookie": `user=${encodedUserData}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 60 * 60}`,
      },
    });

    return response;
  } catch (err) {
    console.error("OAuth callback error:", err);
    return new NextResponse(null, {
      status: 302,
      headers: {
        Location: "/?error=oauth_failed",
      },
    });
  }
}
