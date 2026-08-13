/**
 * Copy text to the clipboard, honestly.
 *
 * Written for paddle's copy-coordinates gesture and shared from here since the
 * village viewer's camera-link button needs exactly the same guarantee.
 *
 * navigator.clipboard only exists in secure contexts — over plain LAN HTTP
 * (or with a browser shield blocking it) it is undefined and the write
 * silently never happens. Fall back to the deprecated-but-working
 * execCommand path, and report honestly whether either took.
 */
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* blocked — try the legacy path */
    }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
