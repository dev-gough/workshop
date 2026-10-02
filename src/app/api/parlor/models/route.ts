import { NextResponse } from 'next/server';
import { parlorModelLists } from '@/lib/parlor-models';
import { getParlorUser, parlorUnauthorized } from '@/lib/parlor-auth';
import { OllamaError, ollamaBaseUrl, ollamaTags } from '@/lib/ollama';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getParlorUser();
  if (!user) return parlorUnauthorized();
  const baseUrl = ollamaBaseUrl();
  if (!baseUrl) {
    return NextResponse.json({ chat: [], image: [], error: 'Ollama isn’t configured on this server.' });
  }
  try {
    const models = await ollamaTags(baseUrl);
    return NextResponse.json({ ...parlorModelLists(models), error: null });
  } catch (err) {
    const message = err instanceof OllamaError ? err.message : 'The laptop isn’t answering.';
    return NextResponse.json({ chat: [], image: [], error: message });
  }
}
