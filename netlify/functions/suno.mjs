// Proxies browser requests to the Suno API so the page never hits CORS issues.
// Only signed-in users are served: the page sends its Supabase access token in
// the X-User-Token header and we check it with Supabase Auth before forwarding.
// The API key comes from the page's Authorization header (entered by the user),
// or from the SUNO_API_KEY environment variable if you choose to set one.

const UPSTREAM = "https://api.sunoapi.org/api/v1";

// Public project values (same as in public/index.html). Override with env vars
// if you move to another Supabase project.
const SUPABASE_URL = process.env.SUPABASE_URL || "https://exdkeaomgxdnnzbszgfs.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_QJaN40fHQHOy6P7ylV78GA_i-BuWuue";

// The page polls every few seconds, so remember tokens we've already checked.
const verified = new Map(); // token -> time (ms) until which it's trusted
const TRUST_MS = 60 * 1000;

async function isSignedIn(token) {
  if (!token) return false;
  const now = Date.now();
  if ((verified.get(token) || 0) > now) return true;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return false;
  if (verified.size > 1000) verified.clear();
  verified.set(token, now + TRUST_MS);
  return true;
}

// Only the endpoints the app uses are forwarded.
const ALLOWED = new Set([
  "GET generate/credit",
  "POST generate",
  "GET generate/record-info",
  "POST generate/extend",
  "POST lyrics",
  "GET lyrics/record-info",
]);

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/suno\/?/, "").replace(/\/$/, "");

  if (!ALLOWED.has(`${req.method} ${path}`)) {
    return json(404, { code: 404, msg: `Unsupported endpoint: ${req.method} ${path}` });
  }

  try {
    if (!(await isSignedIn(req.headers.get("x-user-token")))) {
      return json(401, { code: 401, authError: true, msg: "Please sign in again." });
    }
  } catch (err) {
    return json(502, { code: 502, msg: `Could not reach the login service: ${err.message}` });
  }

  const clientAuth = req.headers.get("authorization");
  const envKey = process.env.SUNO_API_KEY;
  const auth = clientAuth && clientAuth.trim() !== "Bearer" ? clientAuth : envKey ? `Bearer ${envKey}` : null;

  if (!auth) {
    return json(401, { code: 401, msg: "No API key provided. Add your Suno API key in the app settings." });
  }

  try {
    const upstream = await fetch(`${UPSTREAM}/${path}${url.search}`, {
      method: req.method,
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: req.method === "GET" ? undefined : await req.text(),
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (err) {
    return json(502, { code: 502, msg: `Could not reach Suno API: ${err.message}` });
  }
};

export const config = { path: "/api/suno/*" };
