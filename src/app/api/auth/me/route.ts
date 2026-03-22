import { NextRequest, NextResponse } from "next/server";

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const userCookie = request.cookies.get("user");

  if (!userCookie) {
    return NextResponse.json({ authenticated: false, user: null });
  }

  try {
    const decoded = decodeURIComponent(atob(userCookie.value));
    const user = JSON.parse(decoded);

    return NextResponse.json({
      authenticated: true,
      user: {
        ...user,
        subscription_status: "free",
        subscription_plan: null,
      },
    });
  } catch (err) {
    console.error("Auth me error:", err);
    return NextResponse.json({ authenticated: false, user: null });
  }
}
