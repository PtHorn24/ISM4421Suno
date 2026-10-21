// Proxies FAU schedules, scores and news from ESPN's public site API.
// Only signed-in users are served: the page sends its Supabase access token in
// the X-User-Token header and we check it with Supabase Auth before fetching.
// Responses are trimmed down to the fields the app uses and cached briefly.

const ESPN = "https://site.api.espn.com/apis/site/v2/sports";
const FAU_TEAM_ID = "2226";

// Public project values (same as in public/js/app.js). Override with env vars
// if you move to another Supabase project.
const SUPABASE_URL = process.env.SUPABASE_URL || "https://exdkeaomgxdnnzbszgfs.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_QJaN40fHQHOy6P7ylV78GA_i-BuWuue";

// Sports the app shows, keyed by the short name the page uses.
const SPORTS = {
  football: "football/college-football",
  mbb: "basketball/mens-college-basketball",
  wbb: "basketball/womens-college-basketball",
  vb: "volleyball/womens-college-volleyball",
};

// The page polls during live games, so remember tokens we've already checked.
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

// Short in-memory cache so many visitors don't each hit ESPN.
const cache = new Map(); // url -> { until, data }
const CACHE_MS = 60 * 1000;

async function getJSON(url) {
  const hit = cache.get(url);
  if (hit && hit.until > Date.now()) return hit.data;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`ESPN returned ${res.status}`);
  const data = await res.json();
  if (cache.size > 50) cache.clear();
  cache.set(url, { until: Date.now() + CACHE_MS, data });
  return data;
}

const https = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u.replace(/^http:/i, "https:") : "");
const scoreOf = (s) => (s == null ? null : typeof s === "object" ? s.displayValue ?? String(s.value ?? "") : String(s));
const rankOf = (c) => {
  const r = c?.curatedRank?.current;
  return r && r <= 25 ? r : null;
};
const logoOf = (team) => https(team?.logos?.[0]?.href || team?.logo);

function normGame(e) {
  const c = e.competitions?.[0] || {};
  const fau = c.competitors?.find((x) => String(x.team?.id) === FAU_TEAM_ID);
  const opp = c.competitors?.find((x) => x !== fau);
  if (!fau || !opp) return null;
  const st = c.status?.type || e.status?.type || {};
  const fauScore = scoreOf(fau.score);
  const oppScore = scoreOf(opp.score);
  let result = null;
  if (st.completed && fauScore != null && oppScore != null) {
    result = fau.winner ? "W" : opp.winner ? "L" : Number(fauScore) > Number(oppScore) ? "W" : Number(fauScore) < Number(oppScore) ? "L" : "T";
  }
  const venue = c.venue || {};
  const link = (e.links || []).find((l) => l.rel?.includes("summary") && l.rel?.includes("desktop"));
  return {
    id: e.id,
    date: e.date,
    timeTbd: c.timeValid === false || /TBD/i.test(st.shortDetail || ""),
    state: st.state || "pre", // pre | in | post
    detail: st.shortDetail || st.detail || "",
    completed: !!st.completed,
    canceled: /cancel|postpone/i.test(st.name || ""),
    homeAway: fau.homeAway,
    neutral: !!c.neutralSite,
    venue: { name: venue.fullName || "", city: venue.address?.city || "", state: venue.address?.state || "" },
    tv: (c.broadcasts || []).map((b) => b.media?.shortName).filter(Boolean).join(", "),
    opponent: {
      name: opp.team?.displayName || opp.team?.shortDisplayName || "TBA",
      short: opp.team?.shortDisplayName || opp.team?.displayName || "TBA",
      abbr: opp.team?.abbreviation || "",
      logo: logoOf(opp.team),
      rank: rankOf(opp),
    },
    fauRank: rankOf(fau),
    fauScore,
    oppScore,
    result,
    link: https(link?.href),
  };
}

async function schedule(sport) {
  const base = `${ESPN}/${SPORTS[sport]}/teams/${FAU_TEAM_ID}/schedule`;
  let data = await getJSON(base);
  // During the preseason ESPN's default view is empty, so ask for the regular season.
  if (!data.events?.length) data = await getJSON(`${base}?seasontype=2`);
  const team = data.team || {};
  const games = (data.events || []).map(normGame).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
  // ESPN leaves the record out for some sports, so count it from the results.
  const count = (r) => games.filter((g) => g.result === r).length;
  const counted = `${count("W")}-${count("L")}${count("T") ? `-${count("T")}` : ""}`;
  return {
    sport,
    season: data.season?.displayName || "",
    record: team.recordSummary || counted,
    standing: team.standingSummary || "",
    logo: https(team.logo),
    clubhouse: https(team.clubhouse),
    games,
  };
}

async function news(sport) {
  const data = await getJSON(`${ESPN}/${SPORTS[sport]}/news?team=${FAU_TEAM_ID}&limit=8`);
  return {
    sport,
    articles: (data.articles || [])
      .filter((a) => a.headline)
      .map((a) => ({
        id: String(a.id),
        headline: a.headline,
        description: a.description || "",
        type: a.type || "",
        published: a.published || a.lastModified || "",
        image: https((a.images || []).find((i) => i.ratio === "16x9")?.url || a.images?.[0]?.url),
        link: https(a.links?.web?.href),
      })),
  };
}

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extra },
  });

export default async (req) => {
  const url = new URL(req.url);
  const kind = url.pathname.replace(/^\/api\/espn\/?/, "").replace(/\/$/, "");
  const sport = url.searchParams.get("sport") || "";

  if (req.method !== "GET" || !["schedule", "news"].includes(kind)) {
    return json(404, { error: `Unsupported endpoint: ${req.method} ${kind}` });
  }
  if (!SPORTS[sport]) {
    return json(400, { error: `Unknown sport "${sport}". Use one of: ${Object.keys(SPORTS).join(", ")}` });
  }

  try {
    if (!(await isSignedIn(req.headers.get("x-user-token")))) {
      return json(401, { authError: true, error: "Please sign in again." });
    }
  } catch (err) {
    return json(502, { error: `Could not reach the login service: ${err.message}` });
  }

  try {
    const body = kind === "schedule" ? await schedule(sport) : await news(sport);
    return json(200, body, { "cache-control": "private, max-age=30" });
  } catch (err) {
    return json(502, { error: `Could not load FAU ${kind} from ESPN: ${err.message}` });
  }
};

export const config = { path: "/api/espn/*" };
