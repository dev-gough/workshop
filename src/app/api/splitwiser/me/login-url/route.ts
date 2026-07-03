import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, unauthorized } from '@/lib/splitwiser-auth';

export const dynamic = 'force-dynamic';

// GET — return the absolute login URL for the current user, used by the
// settings page to render the QR / copy-link. Kept off the public /me shape
// so the bearer login_token never leaks into unrelated responses.
export async function GET(request: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return unauthorized();
  if (!me.login_token) {
    return NextResponse.json({ error: 'no login token' }, { status: 404 });
  }

  const origin = request.nextUrl.origin;
  const url = `${origin}/projects/splitwiser/login/${me.login_token}`;
  return NextResponse.json({ url });
}
