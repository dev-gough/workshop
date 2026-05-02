import { NextResponse } from 'next/server';
import { getCurrentUser, unauthorized } from '@/lib/splitwiser-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ user });
}
