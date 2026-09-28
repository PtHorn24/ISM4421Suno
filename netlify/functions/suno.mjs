// Proxies browser requests to the Suno API so the page never hits CORS issues.
// The API key comes from the page's Authorization header (entered by the user),
// or from the SUNO_API_KEY environment variable if you choose to set one.

const UPSTREAM = "https://api.sunoapi.org/api/v1";

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
