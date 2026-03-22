export const runtime = 'edge';

export async function GET() {
  return new Response("OK - Edge Function works!", { status: 200 });
}
