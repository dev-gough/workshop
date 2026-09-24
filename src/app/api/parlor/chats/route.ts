import { NextResponse } from 'next/server';
import { getParlorUser, parlorUnauthorized } from '@/lib/parlor-auth';
import { listVisibleChats, shapeChat } from '@/lib/parlor-db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getParlorUser();
  if (!user) return parlorUnauthorized();
  const chats = await listVisibleChats(user.id);
  return NextResponse.json({ chats: chats.map((chat) => shapeChat(chat, user.id)) });
}
