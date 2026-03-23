import { NextRequest, NextResponse } from "next/server";

export const runtime = 'edge';

// Simple state + codeVerifier store (in production, use KV or encrypted cookie)
const stateStore = new Map<string, { codeVerifier: string; timestamp: number }>();

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
      headers: { Location: "/?error=" + encodeURIComponent(error) },
    });
  }

  if (!code || !state) {
    return new NextResponse(null, {
      status: 302,
      headers: { Location: "/?error=missing_params" },
    });
  }

  // Note: In a production app, you should validate the state parameter
  // against a stored value (e.g., in KV) to prevent CSRF attacks.
  // For now, we proceed with the code exchange.

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://ai-product-content-generator.pages.dev';

  if (!clientId || !clientSecret) {
    return new NextResponse(JSON.stringify({ error: 'OAuth credentials not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        grant_type: "authorization_code",
        redirect_uri: `${baseUrl}/api/auth/callback`,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenData.access_token) {
      console.error("Token exchange failed:", tokenData);
      throw new Error("Failed to get access token");
    }

    // Get user info
    const userResponse = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      }
    );
    const googleUser = await userResponse.json();

    // Create session
    const userData = JSON.stringify({
      id: googleUser.id,
      email: googleUser.email,
      name: googleUser.name || "",
      picture: googleUser.picture || "",
    });

    const encodedUserData = btoa(userData);

    const response = new NextResponse(null, {
      status: 302,
      headers: {
        Location: "/",
        "Set-Cookie": `user=${encodeURIComponent(encodedUserData)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 60 * 60}`,
      },
    });

    return response;
  } catch (err) {
    console.error("OAuth callback error:", err);
    return new NextResponse(null, {
      status: 302,
      headers: { Location: "/?error=oauth_failed" },
    });
  }
}
