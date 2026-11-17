// Browser-side helpers for Deepgram live transcription.

/** Opens the Deepgram socket. The docs don't say which subprotocol a
 *  temporary token uses, so try "bearer" first, then "token". */
export async function openDeepgram(url: string, token: string): Promise<WebSocket> {
  const attempt = (scheme: string) =>
    new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(url, [scheme, token]);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("timeout"));
      }, 8000);
      ws.onopen = () => {
        clearTimeout(timer);
        ws.onclose = null;
        resolve(ws);
      };
      ws.onclose = () => {
        clearTimeout(timer);
        reject(new Error("rejected"));
      };
    });
  try {
    return await attempt("bearer");
  } catch {
    return await attempt("token");
  }
}

/** Short-lived token from our server (the real key never reaches the browser). */
export async function getDeepgramToken(): Promise<{ token?: string; error?: string }> {
  try {
    const res = await fetch("/api/deepgram/token", { method: "POST", signal: AbortSignal.timeout(15_000) });
    const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
    if (!res.ok || !body.token) return { error: body.error ?? "Couldn’t start live transcription. Please try again." };
    return { token: body.token };
  } catch {
    return { error: "Live transcription didn’t respond in time. Please try again in a moment." };
  }
}

export const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
