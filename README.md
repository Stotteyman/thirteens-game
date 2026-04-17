# Tien Len Online

Cross-platform Tien Len game built with Expo + React Native + Supabase.

Current status:

- Supabase OAuth sign-in (Google)
- Supabase-backed table, seat, balance, and tournament persistence
- 4-seat realtime gameplay via WebSocket server
- Spectator support and spectator pot contributions
- Web build support for browser play
- Android build profile in EAS for Play Store `.aab`

## Stack

- App: Expo / React Native / TypeScript
- Backend: Node.js + Express + WebSocket
- Database/Auth: Supabase Postgres + Supabase Auth

## Environment variables

Create `.env` from `.env.example` and set:

- `EXPO_PUBLIC_SERVER_URL`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Server startup requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

## Local development

1. Install dependencies:

```bash
npm install
```

2. Run backend:

```bash
npm run server
```

3. Run Expo app:

```bash
npm run start
```

4. Run web preview:

```bash
npm run web
```

## Build website for deployment

Generate static web output:

```bash
npm run build:web
```

Output folder: `dist/`

Local static preview:

```bash
npm run preview:web
```

## Deploy website

You can deploy `dist/` to providers like Vercel, Netlify, Cloudflare Pages, or GitHub Pages.

Important for OAuth:

- Add your deployed site URL to Supabase Auth redirect URLs.
- Keep native scheme redirect for app builds: `thirteens://auth`

## Publish to GitHub

From project root:

```bash
git add .
git commit -m "Prepare web deployment and responsive online play"
git branch -M main
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

## Play Store readiness (Android)

This project already has EAS config with Android app-bundle build type.

1. Login and initialize EAS (if needed):

```bash
npx eas login
npx eas build:configure
```

2. Build Android AAB:

```bash
npx eas build --platform android --profile production
```

3. Submit to Play Console (or use `eas submit`).

## UX behavior target

- Phone users on web should get a mobile-first layout matching Expo feel.
- Desktop users should get a wider, optimized layout.

This repo includes responsive layout behavior in `App.tsx` to support both modes.
