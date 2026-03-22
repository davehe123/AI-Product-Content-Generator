import { NextResponse } from "next/server";

export const runtime = 'edge';

export async function GET(): Promise<Response> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  
  // 直接返回环境变量值看看是否能读取到
  return new Response(JSON.stringify({
    hasClientId: !!clientId,
    clientId: clientId ? clientId.substring(0, 20) + "..." : "undefined",
    baseUrl: baseUrl || "undefined",
    envKeys: Object.keys(process.env).filter(k => k.includes("GOOGLE") || k.includes("BASE"))
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
