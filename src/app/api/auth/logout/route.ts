import { NextResponse } from "next/server";

export const runtime = 'edge';

export async function POST() {
  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": "user=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
    },
  });
}
