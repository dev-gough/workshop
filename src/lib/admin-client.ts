/**
 * Client-side "admin unlock" for privileged endpoints.
 *
 * The mutating server routes (service control, RCON, setup probes, settings
 * writes) require the shared setup token in the `X-Setup-Token` header.
 * `adminFetch` transparently attaches the token stashed in localStorage; on a
 * 401 it prompts the user for the token, stores it, and retries once. A repeat
 * 401 (wrong token entered / cancelled) is surfaced to the caller as the normal
 * Response so existing error handling still works.
 *
 * Server-configuration issues (403 — no setupToken set in config.json) are NOT
 * retried; the caller sees the 403 Response directly.
 */
const TOKEN_KEY = 'workshop_admin_token';

function getToken(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(TOKEN_KEY) ?? '';
}

function setToken(v: string) {
  if (typeof window === 'undefined') return;
  if (v) localStorage.setItem(TOKEN_KEY, v);
  else localStorage.removeItem(TOKEN_KEY);
}

function withToken(init: RequestInit | undefined, token: string): RequestInit {
  const headers = new Headers(init?.headers);
  if (token) headers.set('X-Setup-Token', token);
  return { ...init, headers };
}

export async function adminFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let res = await fetch(input, withToken(init, getToken()));
  if (res.status !== 401) return res;

  // 401: token missing or wrong — prompt once, store, retry.
  const entered = typeof window !== 'undefined'
    ? window.prompt('Admin setup token required to perform this action:', getToken())
    : null;
  if (entered == null) return res; // cancelled — surface the original 401
  setToken(entered.trim());

  res = await fetch(input, withToken(init, getToken()));
  return res;
}
