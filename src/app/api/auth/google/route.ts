import { NextResponse } from "next/server";

export const runtime = 'edge';

function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const randomValues = new Uint32Array(length);
  crypto.getRandomValues(randomValues);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(randomValues[i] % chars.length);
  }
  return result;
}

// SHA256 + Base64URL encoding for PKCE
async function generateCodeChallenge(codeVerifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  // Convert to base64url
  let base64 = btoa(String.fromCharCode(...hashArray));
  // Replace +/= with url-safe alternatives
  base64 = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return base64;
}

export async function GET(): Promise<Response> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://ai-product-content-generator.pages.dev';

  if (!clientId) {
    return new NextResponse(JSON.stringify({ error: 'GOOGLE_CLIENT_ID not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const redirectUri = `${baseUrl}/api/auth/callback`;
  const state = generateRandomString(32);
  const codeVerifier = generateRandomString(64);
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  // Store state and codeVerifier in cookie for callback verification
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  return Response.redirect(authUrl, 302);
}
