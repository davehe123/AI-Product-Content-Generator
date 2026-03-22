import { NextResponse } from "next/server";

export const runtime = 'edge';

function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const randomValues = new Uint32Array(length);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < length; i++) {
    result += chars.charAt(randomValues[i] % chars.length);
  }
  return result;
}

export async function GET(): Promise<Response> {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://75735d62.ai-product-content-generator.pages.dev';
    
    // Debug: return the env values so we can see what's happening
    if (!clientId) {
      return new Response(JSON.stringify({ 
        error: "GOOGLE_CLIENT_ID not set",
        debug: {
          GOOGLE_CLIENT_ID_exists: !!process.env.GOOGLE_CLIENT_ID,
          GOOGLE_CLIENT_ID_value: process.env.GOOGLE_CLIENT_ID || "undefined",
          NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL || "undefined",
        }
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    
    const redirectUri = `${baseUrl}/api/auth/callback`;
    const state = generateRandomString(32);
    const codeVerifier = generateRandomString(64);
    
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state: state,
      code_challenge: codeVerifier,
      code_challenge_method: "plain",
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    
    return Response.redirect(authUrl, 302);
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
