# Suno Studio

A one-page AI music generator built on the [Suno API](https://docs.sunoapi.org), ready to deploy on Netlify.

## Features

- **Profiles.** Each user has a profile with a display name, photo, short bio and favorite genres (which appear first in the style picker). New users are asked to set it up after their first sign-in, and can edit it any time from their avatar in the top right.
- **Google login.** A **Continue with Google** button (Supabase OAuth). The first time someone signs in with Google, their Google name and photo fill in their profile.
- **Email login.** Visitors must sign in with Google or with email and password (Supabase Auth) before they can use the app. Includes sign-up with email confirmation, forgot/reset password and sign out. The Netlify proxy also checks the login, so the API can't be used without an account.
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
3. **Google sign-in** (optional): see *Sign in with Google* below.
4. Supabase's built-in email sender only allows a few emails per hour. For real use, add your own SMTP server under **Authentication → Emails → SMTP Settings**.

### Sign in with Google

The code is done. The credentials are set up by hand. The client secret goes only into Supabase, never into this repo.

1. Supabase: **Authentication → Sign In / Providers → Google**. Copy the **Callback URL** (`https://exdkeaomgxdnnzbszgfs.supabase.co/auth/v1/callback`).
2. Google Cloud: create a project, open **Google Auth Platform → Get started**. Set Branding, choose Audience **External** (add your Gmail under **Test users** while in Testing), and under Data Access check `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile`.
3. **Clients → Create client → Web application.** JavaScript origins: your Netlify URL and `http://localhost:5173`. Redirect URI: the callback URL from step 1. Copy the Client ID and Client secret.
4. Back in Supabase, turn on **Enable Sign in with Google**, paste both values, and save.
5. In **URL Configuration → Redirect URLs**, make sure `https://your-site.netlify.app/**` and `http://localhost:5173/**` are listed.

### Database

`supabase/migrations/20261005200000_profiles.sql` (already applied to the project) creates:

- `public.profiles`: one row per user (`display_name`, `bio`, `avatar_url`, `favorite_genres`), created automatically at sign-up by a trigger. Row Level Security lets each user read and edit only their own row.
- `avatars` storage bucket: public to view, max 2 MB per file, images only. Users can only upload to or delete from a folder named after their own user ID. The app crops photos to 256×256 before uploading.

Each user's saved Suno key and track history are stored in the browser under their own user ID, so two people sharing a computer don't see each other's tracks.

## Project layout

```
public/index.html                  the whole app (HTML + CSS + JS)
netlify/functions/suno.mjs         proxy: /api/suno/* → https://api.sunoapi.org/api/v1/* (signed-in users only)
netlify/functions/suno-callback.mjs  acknowledges Suno's required callBackUrl
netlify.toml                       Netlify build config
supabase/migrations/               database schema (profiles table, avatars bucket)
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

Then open http://localhost:5173 (the port is set in `netlify.toml`).
