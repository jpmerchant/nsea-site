// Shared helpers for the NSEA Worker.
const enc = new TextEncoder();
export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
export const fail = (status, error) => json({ error }, status);
export async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export function rand(n = 24) {
  const a = crypto.getRandomValues(new Uint8Array(n));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function cookieOf(req, name) {
  const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
export const setCookie = (name, token, maxAge) =>
  `${name}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
// Reads the JSON body of a POST and checks Origin on every non-GET request.
export async function readRequest(req, url) {
  let body = {};
  if (req.method !== 'GET') {
    const origin = req.headers.get('origin');
    if (!origin || new URL(origin).host !== url.host) return { error: fail(403, 'Bad origin') };
  }
  if (req.method === 'POST') { try { body = await req.json(); } catch { body = {}; } }
  return { body };
}
