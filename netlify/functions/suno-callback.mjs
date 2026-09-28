// The Suno API requires a callBackUrl on every task. The app polls for results,
// so this endpoint only acknowledges the callback.

export default async () =>
  new Response(JSON.stringify({ status: "received" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

export const config = { path: "/api/suno-callback" };
