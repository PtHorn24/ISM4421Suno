# Suno Studio

A one-page AI music generator built on the [Suno API](https://docs.sunoapi.org), ready to deploy on Netlify.

## Features

- **Email login.** Visitors must sign in with email and password (Supabase Auth) before they can use the app. Includes sign-up with email confirmation, forgot/reset password and sign out. The Netlify proxy also checks the login, so the API can't be used without an account.
- **API key box.** Paste your key from [sunoapi.org/api-key](https://sunoapi.org/api-key). It's saved in your browser's localStorage and tested right away. Remaining credits show in the header.
- **Simple mode.** Describe a song in plain English. Style chips and idea starters are included.
- **Custom mode.** Title, style, your own lyrics, vocal gender, negative tags, duration, style/weirdness/audio-weight sliders and variety.
- **AI lyrics.** Generate lyrics from a short idea and drop them into the lyrics box with one click.
- **Instrumental toggle** and **model picker** (V6, V6 Wild, V6 Mini).
- **Library.** Every generation shows up with live status, a streaming preview while the track renders, cover art, a player, download, lyrics, copy link and **Extend** (continue a song from any point). History is kept in your browser, and unfinished tasks resume polling after a page reload.

## Login (Supabase)

The app uses the Supabase project `exdkeaomgxdnnzbszgfs`. Its URL and publishable key are in `public/index.html` and `netlify/functions/suno.mjs`. Both are public values, not secrets. No database tables are needed: users live in Supabase's built-in `auth.users`.

One-time setup in the Supabase dashboard:

1. **Authentication → URL Configuration.** Set **Site URL** to your Netlify URL (for example `https://your-site.netlify.app`) and add `https://your-site.netlify.app/**` under **Redirect URLs**. Without this, the confirmation and password-reset emails link to `localhost`.
2. **Authentication → Sign In / Providers → Email** is on by default. Leave **Confirm email** on unless you want people to sign in without confirming.
3. Supabase's built-in email sender only allows a few emails per hour. For real use, add your own SMTP server under **Authentication → Emails → SMTP Settings**.

Each user's saved Suno key and track history are stored in the browser under their own user ID, so two people sharing a computer don't see each other's tracks.

## Project layout

```
public/index.html                  the whole app (HTML + CSS + JS)
netlify/functions/suno.mjs         proxy: /api/suno/* → https://api.sunoapi.org/api/v1/* (signed-in users only)
netlify/functions/suno-callback.mjs  acknowledges Suno's required callBackUrl
netlify.toml                       Netlify build config
```

The browser talks to `/api/suno/*`, and a Netlify Function forwards the request to the Suno API. That avoids CORS problems. The function only forwards the endpoints the app uses.

## Deploy to Netlify

1. In Netlify: **Add new site → Import an existing project**, then pick this repo and the `main` branch.
2. Leave the build command empty. `netlify.toml` already sets publish = `public` and functions = `netlify/functions`.
3. Deploy, then do the one-time Supabase setup above.
4. Open the site, create an account, confirm your email, sign in, click **🔑 API key**, and paste your key.

Or with the CLI: `npx netlify-cli deploy --prod`.

### Optional: a server-side key

If you set a `SUNO_API_KEY` environment variable in Netlify (Site settings → Environment variables), the proxy uses it whenever a signed-in user hasn't entered their own key. **Anyone who can create an account could then spend your credits.** To keep it private, turn off **Allow new users to sign up** (Authentication → Sign In / Providers) after creating your own account, and invite people from Authentication → Users.

## Local development

```
npx netlify-cli dev
```

Then open http://localhost:8888.
