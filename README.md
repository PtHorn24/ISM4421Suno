# Owls Gameday

An FAU athletics app for ISM 4421: live scores, schedules, results and news for the Florida Atlantic Owls, with game-day weather. It brings together everything from the earlier assignments (email login, profiles, a Netlify Function API proxy, and the Open-Meteo weather from Owl Weather) in one Netlify site.

## Features

- **Scores and schedules** for Football, Men's Basketball, Women's Basketball and Volleyball. Each sport has its own page with record, conference standing, home record, every game (results with W/L and score, upcoming games with time and TV), and filters for upcoming, results, home and away.
- **Live games.** When a game is in progress the score and clock show with a LIVE badge and refresh automatically about every 45 seconds.
- **Home dashboard.** The next game with a live countdown, the latest results, what's coming up, record cards for every team and the latest news. If you pick favorite teams in your profile, the dashboard shows only those.
- **Game-day weather** (Open-Meteo, no key needed). The forecast for game time at the venue is shown for the next game and for upcoming football games within about two weeks. Current weather on the Boca Raton campus is in the header, with a °F/°C toggle.
- **Add to calendar.** Download any upcoming game as a `.ics` file for Google Calendar, Apple Calendar or Outlook.
- **News.** The latest FAU stories from ESPN for each sport.
- **Email login** (Supabase Auth): sign up with email confirmation, sign in, forgot password and reset password, sign out.
- **Password security:**
  - A strength meter and a live checklist (8+ characters, lowercase, uppercase, number, symbol).
  - New passwords must be 8+ characters, use 3 of the 4 character types, not be a common password (like `password123` or `goowls`) and not contain your email name.
  - **Suggest a strong password** creates a random 16-character password with the browser's secure random generator and copies it for you.
  - Show/hide buttons on every password box, and a confirm box with a match check.
  - **Change password** in your account: you must enter your current password first.
- **Profiles:** display name, photo (cropped to 256×256 and uploaded to Supabase Storage), bio, and the teams you follow. New users are asked to set it up after their first sign-in.

## How it works

```
public/index.html                 page markup (login screen, app, account dialog)
public/css/styles.css             FAU-themed styles (FAU Blue #003366, FAU Red #CC0000)
public/js/password.js             password strength check, meter and generator
public/js/app.js                  app logic: login, profile, ESPN data, weather, rendering
netlify/functions/espn.mjs        proxy: /api/espn/{schedule|news}?sport=football|mbb|wbb|vb
netlify.toml                      Netlify build config and security headers
supabase/migrations/              database schema (profiles table, avatars bucket, favorite sports)
```

The browser asks `/api/espn/...` for data. A Netlify Function checks that you're signed in, fetches FAU's team (ID `2226`) from ESPN's public site API, trims the response down to what the app needs, and caches it for a minute. During the preseason ESPN's default schedule is empty, so the function then asks for the regular season. Weather comes straight from Open-Meteo in the browser.

## Supabase setup

The app uses the Supabase project `exdkeaomgxdnnzbszgfs` (same as Suno Studio). Its URL and publishable key are in `public/js/app.js` and `netlify/functions/espn.mjs`. Both are public values, not secrets.

1. **Resume the project** if it's paused (free projects pause after a week without use): Supabase dashboard → your project → **Restore project**.
2. **Apply the new migration** `supabase/migrations/20261021200000_favorite_sports.sql` (SQL Editor → paste → Run). It adds the `favorite_sports` column to `profiles`. The profiles table and avatars bucket from `20261005200000_profiles.sql` are already there.
3. **Authentication → URL Configuration.** Set **Site URL** to your Netlify URL (for example `https://owls-gameday.netlify.app`) and add `https://owls-gameday.netlify.app/**` under **Redirect URLs**. Without this, the confirmation and password-reset emails link to the old site or `localhost`.
4. Optional: under **Authentication → Sign In / Providers → Email**, set the minimum password length to 8 so the server enforces the same rule as the app.

## Deploy to Netlify

1. In Netlify: **Add new site → Import an existing project**, then pick this repo and branch.
2. Leave the build command empty. `netlify.toml` already sets publish = `public` and functions = `netlify/functions`.
3. Deploy, then do the Supabase steps above.
4. Open the site, create an account, confirm your email, and sign in.

Or with the CLI: `npx netlify-cli deploy --prod`.

## Local development

```
npx netlify-cli dev
```

Then open http://localhost:8888. (The ESPN data needs the Netlify Function, so opening `index.html` directly won't load scores.)

## Credits

Scores, schedules and news from ESPN. Weather data by [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0). This is a student project for ISM 4421 and is not an official FAU or ESPN website.
