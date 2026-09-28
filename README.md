# Suno Studio

A one-page AI music generator built on the [Suno API](https://docs.sunoapi.org), ready to deploy on Netlify.

## Features

- **API key box.** Paste your key from [sunoapi.org/api-key](https://sunoapi.org/api-key). It's saved in your browser's localStorage and tested right away. Remaining credits show in the header.
- **Simple mode.** Describe a song in plain English. Style chips and idea starters are included.
- **Custom mode.** Title, style, your own lyrics, vocal gender, negative tags, duration, style/weirdness/audio-weight sliders and variety.
- **AI lyrics.** Generate lyrics from a short idea and drop them into the lyrics box with one click.
- **Instrumental toggle** and **model picker** (V6, V6 Wild, V6 Mini).
- **Library.** Every generation shows up with live status, a streaming preview while the track renders, cover art, a player, download, lyrics, copy link and **Extend** (continue a song from any point). History is kept in your browser, and unfinished tasks resume polling after a page reload.

## Project layout

```
public/index.html                  the whole app (HTML + CSS + JS)
netlify/functions/suno.mjs         proxy: /api/suno/* → https://api.sunoapi.org/api/v1/*
netlify/functions/suno-callback.mjs  acknowledges Suno's required callBackUrl
netlify.toml                       Netlify build config
```

The browser talks to `/api/suno/*`, and a Netlify Function forwards the request to the Suno API. That avoids CORS problems. The function only forwards the endpoints the app uses.

## Deploy to Netlify

1. In Netlify: **Add new site → Import an existing project**, then pick this repo and the `main` branch.
2. Leave the build command empty. `netlify.toml` already sets publish = `public` and functions = `netlify/functions`.
3. Deploy, open the site, click **🔑 API key**, and paste your key.

Or with the CLI: `npx netlify-cli deploy --prod`.

### Optional: a server-side key

If you set a `SUNO_API_KEY` environment variable in Netlify (Site settings → Environment variables), the proxy uses it whenever a visitor hasn't entered their own key. **Anyone who can open your site could then spend your credits**, so only do this for a private site.

## Local development

```
npx netlify-cli dev
```

Then open http://localhost:8888.
