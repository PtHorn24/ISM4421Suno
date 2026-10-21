/* Owls Gameday: FAU athletics scores, schedules, news and game-day weather.
   Login and profiles use Supabase; sports data comes from ESPN through the
   /api/espn Netlify Function; weather comes straight from Open-Meteo. */
(() => {
  "use strict";

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------
  // Supabase project used for login and profiles. Both values are public by design
  // (the publishable key only allows what your auth settings and RLS allow).
  const SUPABASE_URL = "https://exdkeaomgxdnnzbszgfs.supabase.co";
  const SUPABASE_KEY = "sb_publishable_QJaN40fHQHOy6P7ylV78GA_i-BuWuue";

  const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
  const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
  const FAU_BOCA = { name: "Boca Raton", latitude: 26.3727, longitude: -80.1019 };

  const SPORTS = {
    football: { name: "Football", icon: "🏈", hours: 3.5 },
    mbb: { name: "Men's Basketball", icon: "🏀", hours: 2 },
    wbb: { name: "Women's Basketball", icon: "🏀", hours: 2 },
    vb: { name: "Volleyball", icon: "🏐", hours: 2 },
  };
  const SPORT_KEYS = Object.keys(SPORTS);
  const OUTDOOR = new Set(["football"]); // only show weather on rows for outdoor sports

  const REFRESH_MS = 10 * 60 * 1000; // reload everything this often
  const LIVE_MS = 45 * 1000; // reload a sport this often while one of its games is on

  // WMO weather codes: https://open-meteo.com/en/docs
  const WEATHER_CODES = {
    0: ["Clear", "☀️", "🌙"], 1: ["Mainly clear", "🌤️", "🌙"], 2: ["Partly cloudy", "⛅", "☁️"], 3: ["Overcast", "☁️"],
    45: ["Fog", "🌫️"], 48: ["Fog", "🌫️"], 51: ["Drizzle", "🌦️"], 53: ["Drizzle", "🌦️"], 55: ["Drizzle", "🌧️"],
    56: ["Freezing drizzle", "🌧️"], 57: ["Freezing drizzle", "🌧️"], 61: ["Light rain", "🌦️"], 63: ["Rain", "🌧️"],
    65: ["Heavy rain", "🌧️"], 66: ["Freezing rain", "🌧️"], 67: ["Freezing rain", "🌧️"], 71: ["Light snow", "🌨️"],
    73: ["Snow", "🌨️"], 75: ["Heavy snow", "❄️"], 77: ["Snow", "🌨️"], 80: ["Showers", "🌦️"], 81: ["Showers", "🌧️"],
    82: ["Heavy showers", "⛈️"], 85: ["Snow showers", "🌨️"], 86: ["Snow showers", "🌨️"], 95: ["Thunderstorms", "⛈️"],
    96: ["Thunderstorms", "⛈️"], 99: ["Thunderstorms", "⛈️"],
  };
  const STATE_NAMES = {
    AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
    DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
    IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
    MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
    NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
    NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
    RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
    VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : "");
  const load = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const save = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };

  function toast(msg, kind = "") {
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.textContent = msg;
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), kind === "err" ? 7000 : 4000);
  }

  const fmtDay = (iso) => new Date(iso).toLocaleDateString("en-US", { weekday: "short" });
  const fmtDate = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const fmtTime = (iso) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const fmtLong = (g) => `${new Date(g.date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}${g.timeTbd ? " · time TBD" : ` · ${fmtTime(g.date)}`}`;
  const ago = (iso) => {
    const d = (Date.now() - new Date(iso)) / 1000;
    if (d < 3600) return `${Math.max(1, Math.floor(d / 60))} min ago`;
    if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
    if (d < 7 * 86400) return `${Math.floor(d / 86400)} d ago`;
    return fmtDate(iso);
  };

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let currentUser = null;
  let profile = null; // row from public.profiles
  let profileLoaded = false;
  const schedules = {}; // sport -> schedule from /api/espn/schedule
  const scheduleErr = {}; // sport -> error message
  const news = {}; // sport -> articles
  let unit = load("owls.unit") === "celsius" ? "celsius" : "fahrenheit";
  let view = "home";
  let filter = "all";

  const mySports = () => {
    const favs = (profile?.favorite_sports || []).filter((s) => SPORTS[s]);
    return favs.length ? favs : SPORT_KEYS;
  };
  const allGames = (sports = SPORT_KEYS) =>
    sports.flatMap((s) => (schedules[s]?.games || []).map((g) => ({ ...g, sport: s })));
  const isUpcoming = (g) => g.state === "pre" && !g.canceled;

  // ---------------------------------------------------------------------------
  // ESPN data (through the Netlify Function)
  // ---------------------------------------------------------------------------
  async function api(kind, sport) {
    const token = await getAccessToken();
    let res;
    try {
      res = await fetch(`/api/espn/${kind}?sport=${encodeURIComponent(sport)}`, { headers: { "X-User-Token": token } });
    } catch {
      throw new Error("Network error. Check your connection.");
    }
    let data = null;
    try { data = await res.json(); } catch {}
    if (data?.authError) { sessionLost(); throw new Error("Please sign in again."); }
    if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
    return data;
  }

  async function loadSchedule(sport) {
    try {
      schedules[sport] = await api("schedule", sport);
      delete scheduleErr[sport];
    } catch (err) {
      scheduleErr[sport] = err.message;
    }
    render();
  }

  async function loadNews(sport) {
    try { news[sport] = (await api("news", sport)).articles; } catch { news[sport] = news[sport] || []; }
    render();
  }

  const loadAll = () => Promise.allSettled(SPORT_KEYS.flatMap((s) => [loadSchedule(s), loadNews(s)]));

  // Refresh a sport while one of its games is live (or should have just started).
  function pollLive() {
    if (document.hidden) return;
    const now = Date.now();
    SPORT_KEYS.forEach((s) => {
      const live = (schedules[s]?.games || []).some((g) => {
        const start = new Date(g.date).getTime();
        return g.state === "in" || (g.state === "pre" && !g.timeTbd && start <= now && now - start < 5 * 3600 * 1000);
      });
      if (live) loadSchedule(s);
    });
  }

  // ---------------------------------------------------------------------------
  // Weather (Open-Meteo, no key needed)
  // ---------------------------------------------------------------------------
  const geoCache = new Map(); // "city,ST" -> Promise<{latitude, longitude}|null>
  const wxCache = new Map(); // "lat,lon,unit" -> Promise<forecast>

  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  }

  function describe(code, isDay = 1) {
    const e = WEATHER_CODES[code] || ["Unknown", "🌡️"];
    return { text: e[0], icon: isDay === 0 && e[2] ? e[2] : e[1] };
  }
  const deg = (v) => (Number.isFinite(v) ? `${Math.round(v)}°` : "--");

  function geocode(city, state) {
    if (!city) return Promise.resolve(null);
    if (/^boca raton$/i.test(city) && (!state || state === "FL")) return Promise.resolve(FAU_BOCA);
    const key = `${city},${state}`;
    if (!geoCache.has(key)) {
      const params = new URLSearchParams({ name: city, count: "10", language: "en", format: "json", countryCode: "US" });
      geoCache.set(key, getJSON(`${GEOCODE_URL}?${params}`).then((d) => {
        const list = d.results || [];
        return list.find((r) => r.admin1 === STATE_NAMES[state]) || list[0] || null;
      }).catch(() => null));
    }
    return geoCache.get(key);
  }

  function forecast(place) {
    const key = `${place.latitude.toFixed(2)},${place.longitude.toFixed(2)},${unit}`;
    if (!wxCache.has(key)) {
      const params = new URLSearchParams({
        latitude: place.latitude, longitude: place.longitude,
        current: "temperature_2m,weather_code,is_day",
        hourly: "temperature_2m,precipitation_probability,weather_code,is_day",
        daily: "weather_code,temperature_2m_max,precipitation_probability_max",
        temperature_unit: unit, timezone: "GMT", forecast_days: "16",
      });
      const p = getJSON(`${FORECAST_URL}?${params}`);
      p.catch(() => wxCache.delete(key));
      wxCache.set(key, p);
    }
    return wxCache.get(key);
  }

  // Forecast for kickoff/tip-off time at the venue, or null if it's too far out.
  async function gameWeather(g) {
    if (!isUpcoming(g)) return null;
    const daysOut = (new Date(g.date) - Date.now()) / 86400000;
    if (daysOut > 15) return null;
    const place = await geocode(g.venue.city, g.venue.state);
    if (!place) return null;
    const f = await forecast(place);
    if (g.timeTbd) {
      const i = f.daily.time.indexOf(g.date.slice(0, 10));
      if (i < 0) return null;
      return { ...describe(f.daily.weather_code[i]), temp: f.daily.temperature_2m_max[i], pop: f.daily.precipitation_probability_max[i], daily: true };
    }
    const i = f.hourly.time.indexOf(`${g.date.slice(0, 13)}:00`);
    if (i < 0) return null;
    return { ...describe(f.hourly.weather_code[i], f.hourly.is_day[i]), temp: f.hourly.temperature_2m[i], pop: f.hourly.precipitation_probability[i] };
  }

  // Fill every weather placeholder currently on the page.
  function fillWeather() {
    $$("[data-wx]").forEach(async (el) => {
      const [sport, id] = el.dataset.wx.split(":");
      const g = schedules[sport]?.games.find((x) => x.id === id);
      if (!g) return;
      try {
        const w = await gameWeather(g);
        if (!w || !el.isConnected) return;
        el.title = `${w.text}${w.daily ? " (daytime high)" : " at game time"}${w.pop != null ? `, ${w.pop}% chance of rain` : ""}`;
        el.innerHTML = el.classList.contains("big")
          ? `<span class="wx-icon">${w.icon}</span><span><b>${deg(w.temp)}</b> ${esc(w.text)}${w.pop ? ` · 💧${w.pop}%` : ""}<small>${w.daily ? "Daytime high" : "Forecast at game time"} in ${esc(g.venue.city)}</small></span>`
          : `${w.icon} ${deg(w.temp)}${w.pop >= 30 ? ` 💧${w.pop}%` : ""}`;
        el.classList.remove("hidden");
      } catch {}
    });
  }

  async function loadCampusWeather() {
    try {
      const f = await forecast(FAU_BOCA);
      const w = describe(f.current.weather_code, f.current.is_day);
      const pill = $("#campusWx");
      pill.textContent = `${w.icon} ${deg(f.current.temperature_2m)} Boca Raton`;
      pill.title = `${w.text} on FAU's Boca Raton campus`;
      pill.classList.remove("hidden");
    } catch {}
  }

  function setUnit(u) {
    unit = u;
    save("owls.unit", u);
    $$(".unit-toggle button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.unit === u)));
  }
  $$(".unit-toggle button").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.unit === unit) return;
    setUnit(b.dataset.unit);
    loadCampusWeather();
    render();
  }));
  setUnit(unit);

  // ---------------------------------------------------------------------------
  // Calendar export (.ics)
  // ---------------------------------------------------------------------------
  function downloadIcs(g) {
    const sport = SPORTS[g.sport];
    const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const start = new Date(g.date);
    const icsEsc = (s) => String(s).replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
    const when = g.timeTbd
      ? [`DTSTART;VALUE=DATE:${g.date.slice(0, 10).replace(/-/g, "")}`]
      : [`DTSTART:${stamp(start)}`, `DTEND:${stamp(new Date(start.getTime() + sport.hours * 3600 * 1000))}`];
    const lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Owls Gameday//EN", "BEGIN:VEVENT",
      `UID:${g.sport}-${g.id}@owls-gameday`, `DTSTAMP:${stamp(new Date())}`, ...when,
      `SUMMARY:${icsEsc(`${sport.icon} FAU ${g.homeAway === "away" ? "at" : "vs"} ${g.opponent.short}`)}`,
      `LOCATION:${icsEsc([g.venue.name, g.venue.city, g.venue.state].filter(Boolean).join(", "))}`,
      `DESCRIPTION:${icsEsc(`FAU ${sport.name}${g.tv ? `. TV: ${g.tv}` : ""}${g.timeTbd ? ". Start time TBD." : ""}`)}`,
      g.link ? `URL:${g.link}` : "", "END:VEVENT", "END:VCALENDAR",
    ].filter(Boolean);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/calendar" }));
    a.download = `FAU-${g.sport}-${g.opponent.abbr || "game"}-${g.date.slice(0, 10)}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  const vsAt = (g) => (g.homeAway === "away" && !g.neutral ? "at" : "vs");
  const oppName = (g, short) => `${g.opponent.rank ? `#${g.opponent.rank} ` : ""}${short ? g.opponent.short : g.opponent.name}`;
  const logo = (url, cls = "opp-logo") => (safeUrl(url) ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy">` : `<span class="${cls} blank">?</span>`);

  function scoreHtml(g) {
    if (g.canceled) return `<span class="res X">${esc(g.detail || "Canceled")}</span>`;
    if (g.state === "in") return `<span class="live">● LIVE</span> <b>${esc(g.fauScore ?? 0)}–${esc(g.oppScore ?? 0)}</b> <small>${esc(g.detail)}</small>`;
    if (g.state === "post") return `<span class="res ${esc(g.result || "")}">${esc(g.result || "F")}</span> <b>${esc(g.fauScore)}–${esc(g.oppScore)}</b>`;
    return `<span class="g-time">${g.timeTbd ? "TBD" : esc(fmtTime(g.date))}</span>`;
  }

  function gameRow(g, { compact = false, showSport = false } = {}) {
    const sport = SPORTS[g.sport];
    const where = [g.homeAway === "home" ? "Home" : g.neutral ? "Neutral" : "Away", g.venue.city && `${g.venue.city}${g.venue.state ? `, ${g.venue.state}` : ""}`].filter(Boolean).join(" · ");
    const meta = [showSport && `${sport.icon} ${sport.name}`, !compact && where, isUpcoming(g) && g.tv && `📺 ${g.tv}`].filter(Boolean).join(" · ");
    const showWx = isUpcoming(g) && OUTDOOR.has(g.sport);
    return `
      <li class="game ${esc(g.state)} ${g.homeAway === "home" ? "is-home" : ""}">
        <div class="g-date"><b>${esc(fmtDay(g.date))}</b><span>${esc(fmtDate(g.date))}</span></div>
        ${logo(g.opponent.logo)}
        <div class="g-main">
          <div class="g-opp"><span class="muted">${vsAt(g)}</span> ${esc(oppName(g, compact))}</div>
          ${meta ? `<div class="g-meta">${esc(meta)}</div>` : ""}
        </div>
        <div class="g-right">
          <div class="g-score">${scoreHtml(g)}</div>
          <div class="g-actions">
            ${showWx ? `<span class="g-wx hidden" data-wx="${esc(g.sport)}:${esc(g.id)}"></span>` : ""}
            ${!compact && isUpcoming(g) ? `<button type="button" class="btn xs ghost" data-ics="${esc(g.sport)}:${esc(g.id)}" title="Add to calendar">📅</button>` : ""}
            ${!compact && g.link ? `<a class="btn xs ghost" href="${esc(g.link)}" target="_blank" rel="noopener" title="Open on ESPN">${g.state === "post" ? "Recap" : g.state === "in" ? "Gamecast" : "Preview"} ↗</a>` : ""}
          </div>
        </div>
      </li>`;
  }

  const emptyRow = (text) => `<li class="empty-row">${esc(text)}</li>`;
  const stillLoading = (sports) => sports.some((s) => !schedules[s] && !scheduleErr[s]);

  function newsCards(articles, max) {
    const seen = new Set();
    const list = articles
      .filter((a) => !seen.has(a.headline) && seen.add(a.headline))
      .sort((a, b) => b.published.localeCompare(a.published))
      .slice(0, max);
    if (!list.length) return `<p class="muted">No recent stories.</p>`;
    return list.map((a) => `
      <a class="news-card" href="${esc(safeUrl(a.link) || "#")}" target="_blank" rel="noopener">
        ${safeUrl(a.image) ? `<img src="${esc(a.image)}" alt="" loading="lazy">` : `<div class="news-ph">🦉</div>`}
        <div class="news-body">
          <div class="news-tag">${a.sport ? `${SPORTS[a.sport].icon} ${esc(SPORTS[a.sport].name)} · ` : ""}${esc(a.type)}${a.published ? ` · ${esc(ago(a.published))}` : ""}</div>
          <div class="news-head">${esc(a.headline)}</div>
          ${a.description ? `<div class="news-desc">${esc(a.description)}</div>` : ""}
        </div>
      </a>`).join("");
  }
  const newsFor = (sports) => sports.flatMap((s) => (news[s] || []).map((a) => ({ ...a, sport: s })));

  function renderNextGame() {
    const sports = mySports();
    const games = allGames(sports);
    const live = games.find((g) => g.state === "in");
    const next = live || games.filter(isUpcoming).sort((a, b) => a.date.localeCompare(b.date))[0];
    const root = $("#nextGame");
    if (!next) {
      root.innerHTML = stillLoading(sports)
        ? `<div class="hero card loading"><span class="spin dark"></span> Loading schedules…</div>`
        : `<div class="hero card"><div class="muted">No upcoming games on the schedule right now. Check back soon!</div></div>`;
      return;
    }
    const sport = SPORTS[next.sport];
    const fau = schedules[next.sport]?.logo || "https://a.espncdn.com/i/teamlogos/ncaa/500/2226.png";
    const home = next.homeAway === "home";
    const sideFau = `<div class="side">${logo(fau, "hero-logo")}<b>FAU</b>${next.fauRank ? `<small>#${next.fauRank}</small>` : ""}</div>`;
    const sideOpp = `<div class="side">${logo(next.opponent.logo, "hero-logo")}<b>${esc(next.opponent.short)}</b>${next.opponent.rank ? `<small>#${next.opponent.rank}</small>` : ""}</div>`;
    root.innerHTML = `
      <div class="hero card ${live ? "is-live" : ""}">
        <div class="hero-label">${live ? `<span class="live">● LIVE NOW</span>` : "Next game"} · ${sport.icon} ${esc(sport.name)}</div>
        <div class="hero-match">
          ${home ? sideOpp : sideFau}
          <div class="hero-mid">
            ${live ? `<div class="hero-score">${esc(next.fauScore ?? 0)}–${esc(next.oppScore ?? 0)}</div><div>${esc(next.detail)}</div>`
                   : `<div class="hero-at">${next.neutral ? "vs" : "@"}</div><div class="countdown" data-countdown="${esc(next.date)}" data-tbd="${next.timeTbd ? 1 : ""}"></div>`}
          </div>
          ${home ? sideFau : sideOpp}
        </div>
        <div class="hero-info">
          <div>🗓️ ${esc(fmtLong(next))}</div>
          ${next.venue.name ? `<div>📍 ${esc(next.venue.name)}${next.venue.city ? `, ${esc(next.venue.city)}` : ""}</div>` : ""}
          ${next.tv ? `<div>📺 ${esc(next.tv)}</div>` : ""}
        </div>
        <div class="hero-foot">
          <span class="g-wx big hidden" data-wx="${esc(next.sport)}:${esc(next.id)}"></span>
          <span class="btn-row">
            ${!live ? `<button type="button" class="btn sm" data-ics="${esc(next.sport)}:${esc(next.id)}">📅 Add to calendar</button>` : ""}
            ${next.link ? `<a class="btn sm primary" href="${esc(next.link)}" target="_blank" rel="noopener">${live ? "Gamecast" : "Preview"} on ESPN ↗</a>` : ""}
          </span>
        </div>
      </div>`;
    tickCountdowns();
  }

  function tickCountdowns() {
    $$("[data-countdown]").forEach((el) => {
      const ms = new Date(el.dataset.countdown) - Date.now();
      if (el.dataset.tbd) {
        const days = Math.ceil(ms / 86400000);
        el.innerHTML = days <= 0 ? "<b>Today</b>" : `<b>${days}</b> day${days === 1 ? "" : "s"}`;
        return;
      }
      if (ms <= 0) { el.innerHTML = "<b>Starting now</b>"; return; }
      const d = Math.floor(ms / 86400000), h = Math.floor(ms / 3600000) % 24, m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
      const parts = d ? [[d, "d"], [h, "h"], [m, "m"]] : [[h, "h"], [m, "m"], [s, "s"]];
      el.innerHTML = parts.map(([v, u]) => `<span><b>${v}</b>${u}</span>`).join("");
    });
  }

  function renderHome() {
    const name = profile?.display_name || currentUser?.email?.split("@")[0] || "";
    const hr = new Date().getHours();
    $("#greeting").textContent = `${hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening"}${name ? `, ${name}` : ""}! 🦉`;
    const favs = profile?.favorite_sports?.length;
    $("#greetingSub").innerHTML = favs
      ? `Showing the teams you follow. <button type="button" class="link-btn" data-open-account>Change</button>`
      : `Showing every FAU team. <button type="button" class="link-btn" data-open-account>Pick your favorites</button>`;

    renderNextGame();

    const sports = mySports();
    const games = allGames(sports);
    const loading = stillLoading(sports);
    const upcoming = games.filter(isUpcoming).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
    const results = games.filter((g) => g.state === "post").sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
    $("#upcomingList").innerHTML = upcoming.length ? upcoming.map((g) => gameRow(g, { compact: true, showSport: sports.length > 1 })).join("") : emptyRow(loading ? "Loading…" : "Nothing scheduled.");
    $("#resultsList").innerHTML = results.length ? results.map((g) => gameRow(g, { compact: true, showSport: sports.length > 1 })).join("") : emptyRow(loading ? "Loading…" : "No results yet this season.");

    const order = [...sports, ...SPORT_KEYS.filter((s) => !sports.includes(s))];
    $("#teamGrid").innerHTML = order.map((s) => {
      const d = schedules[s];
      const next = d?.games.find(isUpcoming);
      const last = d?.games.filter((g) => g.state === "post").pop();
      const fav = profile?.favorite_sports?.includes(s);
      return `
        <a class="team-card" href="#${s}">
          <div class="tc-top"><span class="tc-icon">${SPORTS[s].icon}</span><b>${esc(SPORTS[s].name)}</b>${fav ? `<span class="star" title="You follow this team">★</span>` : ""}</div>
          <div class="tc-record">${d ? esc(d.record || "0-0") : scheduleErr[s] ? "—" : "…"}</div>
          <div class="tc-sub">${esc(d?.standing || d?.season || scheduleErr[s] || "")}</div>
          <div class="tc-sub">${last ? `Last: <span class="res ${esc(last.result || "")}">${esc(last.result || "F")}</span> ${esc(last.fauScore)}–${esc(last.oppScore)} ${vsAt(last)} ${esc(last.opponent.abbr || last.opponent.short)}` : ""}</div>
          <div class="tc-sub">${next ? `Next: ${esc(fmtDate(next.date))} ${vsAt(next)} ${esc(next.opponent.short)}` : d ? "No upcoming games" : ""}</div>
        </a>`;
    }).join("");

    $("#homeNews").innerHTML = newsCards(newsFor(sports), 4);
  }

  function renderSport(s) {
    const d = schedules[s];
    const info = SPORTS[s];
    $("#sportTitle").textContent = `${info.icon} FAU ${info.name}`;
    $("#sportMeta").textContent = d ? [d.season && `${d.season} season`, d.standing].filter(Boolean).join(" · ") : scheduleErr[s] || "Loading…";
    const games = d?.games || [];
    const done = games.filter((g) => g.state === "post");
    const homeDone = done.filter((g) => g.homeAway === "home");
    const wins = (list) => list.filter((g) => g.result === "W").length;
    $("#sportStats").innerHTML = d ? `
      <div><b>${esc(d.record || `${wins(done)}-${done.length - wins(done)}`)}</b><span>Overall</span></div>
      <div><b>${wins(homeDone)}-${homeDone.length - wins(homeDone)}</b><span>Home</span></div>
      <div><b>${games.filter(isUpcoming).length}</b><span>Games left</span></div>` : "";

    $$(".filters button").forEach((b) => b.classList.toggle("on", b.dataset.filter === filter));
    const shown = games.map((g) => ({ ...g, sport: s })).filter((g) => ({
      all: true, upcoming: isUpcoming(g) || g.state === "in", results: g.state === "post", home: g.homeAway === "home", away: g.homeAway !== "home",
    })[filter]);
    $("#sportGames").innerHTML = shown.length ? shown.map((g) => gameRow(g)).join("")
      : emptyRow(!d && !scheduleErr[s] ? "Loading schedule…" : scheduleErr[s] ? `Couldn't load the schedule: ${scheduleErr[s]}` : "No games match this filter.");
    $("#sportNews").innerHTML = news[s] ? newsCards(newsFor([s]), 6) : `<p class="muted">Loading…</p>`;
  }

  function render() {
    if (!currentUser) return;
    const sportView = SPORTS[view];
    $$("[data-view]").forEach((el) => el.classList.toggle("hidden", el.dataset.view !== (sportView ? "sport" : view)));
    $$(".tabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === view));
    if (view === "home") renderHome();
    else if (sportView) renderSport(view);
    else if (view === "news") $("#allNews").innerHTML = newsCards(newsFor(SPORT_KEYS), 40);
    fillWeather();
  }

  function route() {
    const v = location.hash.slice(1);
    const next = SPORTS[v] || v === "news" ? v : "home";
    if (next !== view) { view = next; filter = "all"; window.scrollTo(0, 0); }
    document.title = `${SPORTS[view] ? `FAU ${SPORTS[view].name}` : view === "news" ? "News" : "Owls Gameday"} | Owls Gameday`;
    render();
  }
  window.addEventListener("hashchange", route);

  $$(".filters button").forEach((b) => b.addEventListener("click", () => { filter = b.dataset.filter; render(); }));
  document.addEventListener("click", (e) => {
    const ics = e.target.closest("[data-ics]");
    if (ics) {
      const [sport, id] = ics.dataset.ics.split(":");
      const g = schedules[sport]?.games.find((x) => x.id === id);
      if (g) downloadIcs({ ...g, sport });
    }
    if (e.target.closest("[data-open-account]")) openAccount();
  });

  // ---------------------------------------------------------------------------
  // Boot (runs once a user is signed in)
  // ---------------------------------------------------------------------------
  let started = false;
  function startApp() {
    if (started) return;
    started = true;
    route();
    loadAll();
    loadCampusWeather();
    setInterval(tickCountdowns, 1000);
    setInterval(pollLive, LIVE_MS);
    setInterval(() => { if (!document.hidden) { loadAll(); loadCampusWeather(); } }, REFRESH_MS);
  }

  // ---------------------------------------------------------------------------
  // Login (Supabase Auth)
  // ---------------------------------------------------------------------------
  const sb = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  const redirectTo = /^https?:$/.test(location.protocol) ? `${location.origin}/` : undefined;

  async function getAccessToken() {
    if (!sb) return "";
    try { const { data } = await sb.auth.getSession(); return data.session?.access_token || ""; } catch { return ""; }
  }

  let lostHandled = false;
  async function sessionLost() {
    if (lostHandled) return;
    lostHandled = true;
    toast("Your session expired. Please sign in again.", "err");
    try { await sb?.auth.signOut({ scope: "local" }); } catch {}
    location.reload();
  }

  const AUTH_VIEWS = {
    signin: { title: "Sign in", sub: "Use your email and password.", submit: "Sign in", pass: true, passAuto: "current-password" },
    signup: { title: "Create your account", sub: "Sign up with your email. We'll send a link to confirm it.", submit: "Create account", pass: true, passAuto: "new-password", newPw: true },
    forgot: { title: "Reset your password", sub: "Enter your email and we'll send you a reset link.", submit: "Send reset link", pass: false },
    reset: { title: "Choose a new password", sub: "Enter a new password for your account.", submit: "Save new password", pass: true, passAuto: "new-password", newPw: true, noEmail: true },
  };
  let authView = "signin";
  let recoveryEmail = "";

  function showMsg(sel, text, kind = "") {
    const el = $(sel);
    el.className = `msg ${kind}`;
    el.textContent = text;
    el.classList.toggle("hidden", !text);
  }
  const authMsg = (text, kind) => showMsg("#authMsg", text, kind);

  // Show/hide buttons next to every password box.
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-toggle-pw]");
    if (!b) return;
    const input = document.getElementById(b.dataset.togglePw);
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    b.textContent = show ? "Hide" : "Show";
    b.setAttribute("aria-label", show ? "Hide password" : "Show password");
  });
  function hidePasswords(...ids) {
    ids.forEach((id) => {
      document.getElementById(id).type = "password";
      const b = $(`[data-toggle-pw="${id}"]`);
      b.textContent = "Show"; b.setAttribute("aria-label", "Show password");
    });
  }

  // Live strength meter + "passwords match" hint for a new-password pair.
  function wirePasswordPair({ pass, confirm, meter, match, generate, email }) {
    const update = () => {
      Password.renderMeter($(meter), $(pass).value, email());
      const a = $(pass).value, b = $(confirm).value;
      $(match).textContent = !b ? "" : a === b ? "✓ Passwords match" : "✗ Passwords don't match yet";
      $(match).className = `hint ${!b ? "" : a === b ? "good" : "bad"}`;
    };
    $(pass).addEventListener("input", update);
    $(confirm).addEventListener("input", update);
    $(generate).addEventListener("click", async () => {
      const pw = Password.generate(16);
      $(pass).value = pw; $(confirm).value = pw;
      [pass, confirm].forEach((sel) => {
        $(sel).type = "text";
        const b = $(`[data-toggle-pw="${sel.slice(1)}"]`);
        b.textContent = "Hide"; b.setAttribute("aria-label", "Hide password");
      });
      $(pass).dispatchEvent(new Event("input", { bubbles: true })); // redraws the meter and clears old errors
      try { await navigator.clipboard.writeText(pw); toast("Strong password filled in and copied. Save it in your password manager!", "ok"); }
      catch { toast("Strong password filled in. Save it in your password manager!", "ok"); }
    });
    return update;
  }

  // Checks a new password + confirmation; returns an error message or "".
  function newPasswordProblem(pw, pw2, email) {
    const r = Password.check(pw, email);
    if (!r.ok) return r.problems[0] || `Your password needs at least ${Password.MIN_LENGTH} characters and 3 of: lowercase, uppercase, numbers, symbols.`;
    if (pw !== pw2) return "The two passwords don't match.";
    return "";
  }

  const updateAuthMeter = wirePasswordPair({
    pass: "#authPass", confirm: "#authPass2", meter: "#authMeter", match: "#authMatch", generate: "#authGenerate",
    email: () => (authView === "reset" ? recoveryEmail : $("#authEmail").value.trim()),
  });

  function setAuthView(v, { keepMsg = false } = {}) {
    authView = v;
    const cfg = AUTH_VIEWS[v];
    $("#authTitle").textContent = cfg.title;
    $("#authSub").textContent = cfg.sub;
    $("#authSubmit").textContent = cfg.submit;
    $("#authEmailWrap").classList.toggle("hidden", !!cfg.noEmail);
    $("#authPassWrap").classList.toggle("hidden", !cfg.pass);
    $("#authNewPw").classList.toggle("hidden", !cfg.newPw);
    $("label[for=authPass]").textContent = cfg.newPw ? (v === "reset" ? "New password" : "Choose a password") : "Password";
    $("#authPass").autocomplete = cfg.passAuto || "off";
    $("#authPass").value = ""; $("#authPass2").value = "";
    hidePasswords("authPass", "authPass2");
    updateAuthMeter();
    $("#toSignup").classList.toggle("hidden", v !== "signin");
    $("#toSignin").classList.toggle("hidden", v === "signin" || v === "reset");
    $("#toForgot").classList.toggle("hidden", v !== "signin");
    if (!keepMsg) authMsg("");
    showAuth();
    (cfg.noEmail || ($("#authEmail").value && cfg.pass) ? $("#authPass") : $("#authEmail")).focus();
  }

  function showAuth() {
    document.body.classList.remove("authed");
    $("#authLoading").classList.add("hidden");
    $("#authPanel").classList.remove("hidden");
  }

  function showApp(user) {
    currentUser = user;
    renderProfileBadge();
    document.body.classList.add("authed");
    startApp();
    loadProfile(user);
  }

  $$("[data-auth-view]").forEach((b) => b.addEventListener("click", () => setAuthView(b.dataset.authView)));
  // Clear an old error as soon as the visitor starts fixing it.
  $("#authForm").addEventListener("input", () => { if ($("#authMsg").classList.contains("err")) authMsg(""); });

  $("#authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#authEmail").value.trim();
    const password = $("#authPass").value;
    const cfg = AUTH_VIEWS[authView];
    if (!cfg.noEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { authMsg("Enter a valid email address.", "err"); return; }
    if (authView === "signin" && !password) { authMsg("Enter your password.", "err"); return; }
    if (cfg.newPw) {
      const problem = newPasswordProblem(password, $("#authPass2").value, cfg.noEmail ? recoveryEmail : email);
      if (problem) { authMsg(problem, "err"); return; }
    }

    const btn = $("#authSubmit");
    btn.disabled = true; btn.innerHTML = `<span class="spin"></span>`;
    authMsg("");
    try {
      if (authView === "signin") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) {
          if (/not confirmed/i.test(error.message)) throw new Error("Please confirm your email first. Check your inbox for the link.");
          if (/invalid login credentials/i.test(error.message)) throw new Error("Wrong email or password.");
          throw error;
        }
      } else if (authView === "signup") {
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
        if (error) throw error;
        if (!data.session) {
          // Email confirmation is on: the user must click the link we just sent.
          setAuthView("signin", { keepMsg: true });
          $("#authEmail").value = email;
          authMsg(`Almost done. We sent a confirmation link to ${email}. Click it, then sign in.`, "ok");
        }
      } else if (authView === "forgot") {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
        setAuthView("signin", { keepMsg: true });
        authMsg(`If ${email} has an account, a reset link is on its way.`, "ok");
      } else if (authView === "reset") {
        const { error } = await sb.auth.updateUser({ password });
        if (error) throw error;
        const { data } = await sb.auth.getSession();
        toast("Password updated", "ok");
        if (data.session) showApp(data.session.user); else setAuthView("signin");
      }
    } catch (err) {
      authMsg(err.message || "Something went wrong. Try again.", "err");
    } finally {
      btn.disabled = false; btn.textContent = AUTH_VIEWS[authView].submit;
    }
  });

  $("#signOutBtn").addEventListener("click", async () => {
    $("#signOutBtn").disabled = true;
    try { await sb.auth.signOut(); } catch {}
    location.reload();
  });

  // ---------------------------------------------------------------------------
  // Account: profile (public.profiles + "avatars" bucket) and change password
  // ---------------------------------------------------------------------------
  let draft = null; // edits in the open profile form

  const initial = (name) => (name || "?").trim().charAt(0).toUpperCase() || "?";
  const avatarHtml = (url, name) => (url ? `<img src="${esc(url)}" alt="">` : esc(initial(name)));

  function renderProfileBadge() {
    const name = profile?.display_name || currentUser?.email?.split("@")[0] || "Account";
    $("#headerAvatar").innerHTML = avatarHtml(safeUrl(profile?.avatar_url), name);
    $("#profileName").textContent = name;
    $("#profileBtn").title = `Your account (${currentUser?.email || ""})`;
  }

  async function loadProfile(user) {
    try {
      let { data, error } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
      if (error) throw error;
      if (!data) {
        // Normally created at sign-up by a database trigger; create it here if missing.
        ({ data, error } = await sb.from("profiles").upsert({ id: user.id }).select().single());
        if (error) throw error;
      }
      profile = data;
      profileLoaded = true;
      renderProfileBadge();
      render();
      if (!profile.display_name && load(`owls.profileSkipped:${user.id}`) !== "1") openAccount({ welcome: true });
    } catch (err) {
      toast(`Could not load your profile: ${err.message}`, "err");
    }
  }

  function renderDraft() {
    $("#pfAvatar").innerHTML = avatarHtml(safeUrl(draft.avatar_url), $("#pfName").value || currentUser?.email);
    $("#pfRemovePhoto").classList.toggle("hidden", !draft.avatar_url);
    $("#pfSports").innerHTML = SPORT_KEYS.map((s) => {
      const on = draft.favorite_sports.includes(s);
      return `<button type="button" class="chip ${on ? "on" : ""}" data-sport="${s}" aria-pressed="${on}">${on ? "★" : "+"} ${SPORTS[s].icon} ${esc(SPORTS[s].name)}</button>`;
    }).join("");
  }

  function setAccountTab(tab) {
    $$("[data-acct-tab]").forEach((b) => b.classList.toggle("on", b.dataset.acctTab === tab));
    $$("[data-acct-pane]").forEach((p) => p.classList.toggle("hidden", p.dataset.acctPane !== tab));
  }
  $$("[data-acct-tab]").forEach((b) => b.addEventListener("click", () => setAccountTab(b.dataset.acctTab)));

  function openAccount({ welcome = false } = {}) {
    if (!profileLoaded) { toast("Your profile is still loading…"); return; }
    draft = { avatar_url: profile.avatar_url || "", favorite_sports: [...(profile.favorite_sports || [])], welcome };
    $("#accountTitle").textContent = welcome ? "👋 Welcome, Owl! Set up your profile" : "Your account";
    $("#accountSub").textContent = welcome ? "Pick a name, a photo and the teams you follow. You can change these any time from the top right." : "Your profile and sign-in settings.";
    $("#pfCancel").textContent = welcome ? "Skip for now" : "Cancel";
    $("#pfName").value = profile.display_name || "";
    $("#pfBio").value = profile.bio || "";
    $("#pfEmail").value = currentUser?.email || "";
    ["#pfName", "#pfBio"].forEach((sel) => $(sel).dispatchEvent(new Event("input")));
    $("#passwordForm").reset(); updatePwMeter(); showMsg("#pwMsg", "");
    hidePasswords("pwCurrent", "pwNew", "pwNew2");
    renderDraft();
    setAccountTab("profile");
    $("#accountModal").classList.remove("hidden");
    $("#pfName").focus();
  }

  function closeAccount() {
    if (draft?.welcome) save(`owls.profileSkipped:${currentUser.id}`, "1");
    $("#accountModal").classList.add("hidden");
    $("#pfFile").value = "";
    draft = null;
  }

  const counter = (inputSel, outSel) => {
    const upd = () => { $(outSel).textContent = $(inputSel).value.length; };
    $(inputSel).addEventListener("input", upd); upd();
  };
  counter("#pfName", "#pfNameCount");
  counter("#pfBio", "#pfBioCount");
  $("#pfName").addEventListener("input", () => { if (draft && !draft.avatar_url) renderDraft(); });
  $("#profileBtn").addEventListener("click", () => openAccount());
  $("#pfCancel").addEventListener("click", closeAccount);
  $("#accountClose").addEventListener("click", closeAccount);
  $("#accountModal").addEventListener("click", (e) => { if (e.target.id === "accountModal") closeAccount(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && draft) closeAccount(); });

  $("#pfSports").addEventListener("click", (e) => {
    const c = e.target.closest("[data-sport]"); if (!c || !draft) return;
    const s = c.dataset.sport;
    draft.favorite_sports = draft.favorite_sports.includes(s) ? draft.favorite_sports.filter((x) => x !== s) : [...draft.favorite_sports, s];
    renderDraft();
  });

  // Crop to a centered square and shrink to 256px so uploads stay small.
  function squareImage(file, size = 256) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        canvas.getContext("2d").drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not process the image."))), "image/jpeg", 0.88);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file isn't an image we can read.")); };
      img.src = url;
    });
  }

  $("#pfFile").addEventListener("change", async () => {
    const file = $("#pfFile").files[0];
    if (!file || !draft) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { toast("Choose a PNG, JPG, WebP or GIF image", "err"); return; }
    if (file.size > 15 * 1024 * 1024) { toast("That image is too large (max 15 MB)", "err"); return; }
    const label = $("label[for=pfFile]");
    label.innerHTML = `<span class="spin dark"></span> Uploading…`;
    try {
      const blob = await squareImage(file);
      const path = `${currentUser.id}/avatar-${Date.now()}.jpg`;
      const { error } = await sb.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
      if (error) throw error;
      draft.avatar_url = sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
      renderDraft();
    } catch (err) {
      toast(`Upload failed: ${err.message}`, "err");
    } finally {
      label.textContent = "📷 Upload photo";
      $("#pfFile").value = "";
    }
  });

  $("#pfRemovePhoto").addEventListener("click", () => { if (draft) { draft.avatar_url = ""; renderDraft(); } });

  // Delete old avatar files the profile no longer points to.
  async function cleanupAvatars(keepUrl) {
    try {
      const { data } = await sb.storage.from("avatars").list(currentUser.id);
      const stale = (data || []).map((f) => `${currentUser.id}/${f.name}`).filter((p) => !keepUrl || !keepUrl.endsWith(`/${p}`));
      if (stale.length) await sb.storage.from("avatars").remove(stale);
    } catch {}
  }

  $("#profileForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!draft) return;
    const display_name = $("#pfName").value.trim();
    const bio = $("#pfBio").value.trim();
    if (!display_name) { toast("Enter a display name", "err"); $("#pfName").focus(); return; }
    const btn = $("#pfSave");
    btn.disabled = true; btn.innerHTML = `<span class="spin"></span> Saving…`;
    try {
      const { data, error } = await sb.from("profiles").upsert({
        id: currentUser.id,
        display_name,
        bio: bio || null,
        avatar_url: draft.avatar_url || null,
        favorite_sports: SPORT_KEYS.filter((s) => draft.favorite_sports.includes(s)),
      }).select().single();
      if (error) throw error;
      profile = data;
      renderProfileBadge();
      cleanupAvatars(profile.avatar_url);
      draft.welcome = false;
      closeAccount();
      render();
      toast("Profile saved", "ok");
    } catch (err) {
      const msg = /favorite_sports/.test(err.message) ? "The database is missing the favorite_sports column. Apply the migration in supabase/migrations." : err.message;
      toast(`Could not save your profile: ${msg}`, "err");
    } finally {
      btn.disabled = false; btn.textContent = "Save profile";
    }
  });

  const updatePwMeter = wirePasswordPair({
    pass: "#pwNew", confirm: "#pwNew2", meter: "#pwMeter", match: "#pwMatch", generate: "#pwGenerate",
    email: () => currentUser?.email || "",
  });

  $("#passwordForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const current = $("#pwCurrent").value;
    const pw = $("#pwNew").value;
    if (!current) { showMsg("#pwMsg", "Enter your current password.", "err"); return; }
    const problem = newPasswordProblem(pw, $("#pwNew2").value, currentUser.email);
    if (problem) { showMsg("#pwMsg", problem, "err"); return; }
    if (pw === current) { showMsg("#pwMsg", "Your new password must be different from the current one.", "err"); return; }

    const btn = $("#pwSave");
    btn.disabled = true; btn.innerHTML = `<span class="spin"></span>`;
    showMsg("#pwMsg", "");
    try {
      // Confirm it's really you before changing the password.
      const { error: authErr } = await sb.auth.signInWithPassword({ email: currentUser.email, password: current });
      if (authErr) throw new Error(/invalid login/i.test(authErr.message) ? "Your current password is incorrect." : authErr.message);
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) throw error;
      $("#passwordForm").reset(); updatePwMeter();
      hidePasswords("pwCurrent", "pwNew", "pwNew2");
      showMsg("#pwMsg", "✓ Password changed. Use your new password next time you sign in.", "ok");
      toast("Password changed", "ok");
    } catch (err) {
      showMsg("#pwMsg", err.message || "Could not change your password.", "err");
    } finally {
      btn.disabled = false; btn.textContent = "Change password";
    }
  });

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------
  (async function initAuth() {
    if (!sb) {
      showAuth();
      $("#authForm").classList.add("hidden");
      $(".auth-links").classList.add("hidden");
      authMsg("Could not load the login library. Check your connection and reload.", "err");
      return;
    }
    // Errors from an expired or reused email link come back in the URL hash.
    const hash = new URLSearchParams(location.hash.slice(1));
    const linkError = hash.get("error_description");
    const recovering = hash.get("type") === "recovery";

    sb.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") { recoveryEmail = session?.user?.email || ""; setAuthView("reset"); return; }
      if (event === "SIGNED_IN" && session && !started && !recovering && authView !== "reset") setTimeout(() => showApp(session.user), 0);
      if (event === "SIGNED_OUT" && started) location.reload();
    });

    const { data } = await sb.auth.getSession();
    if (linkError || location.hash.includes("access_token")) history.replaceState(null, "", location.pathname + location.search);
    if (recovering || authView === "reset") { recoveryEmail = data.session?.user?.email || ""; setAuthView("reset"); return; }
    if (data.session) { showApp(data.session.user); return; }
    setAuthView("signin");
    if (linkError) authMsg(`${linkError.replace(/\+/g, " ")}. Request a new link and try again.`, "err");
  })();
})();
