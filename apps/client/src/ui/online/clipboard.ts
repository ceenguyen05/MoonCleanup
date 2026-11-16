/** Invite-link building and a clipboard write that degrades safely (insecure context, denied permission, old browsers). */

/** Full invite link `<origin>/join/<code>`; the code is the canonical 8-character form (URL-safe alphabet). */
export function inviteUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/join/${encodeURIComponent(code)}`;
}

export interface ClipboardEnv {
  readonly clipboard?: { writeText(text: string): Promise<void> } | undefined;
  /** Synchronous legacy copy (textarea + execCommand); returns whether it worked. */
  readonly legacyCopy?: ((text: string) => boolean) | undefined;
}

function legacyCopyViaTextarea(text: string): boolean {
  if (typeof document === "undefined") return false;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "-9999px";
  area.style.opacity = "0";
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  previous?.focus();
  return ok;
}

export function browserClipboardEnv(): ClipboardEnv {
  return {
    clipboard: typeof navigator === "undefined" ? undefined : navigator.clipboard,
    legacyCopy: legacyCopyViaTextarea,
  };
}

/** Resolves true when the text reached the clipboard; never rejects. */
export async function copyText(text: string, env: ClipboardEnv = browserClipboardEnv()): Promise<boolean> {
  if (env.clipboard !== undefined) {
    try {
      await env.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy path (permission denied, document not focused)
    }
  }
  try {
    return env.legacyCopy?.(text) ?? false;
  } catch {
    return false;
  }
}
