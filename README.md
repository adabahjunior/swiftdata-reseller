# SwiftData Reseller

API data purchasing platform with user dashboard, admin panel, and manual MoMo top-ups.

Built by **SCQEEL TECHNOLOGIES**.

## Stack

- React + TypeScript + Vite + Tailwind CSS
- Supabase (auth, database, edge functions)

## Local development

```bash
npm install
cp .env.example .env.local
# Add your Supabase URL and anon key to .env.local
npm run dev
```

App runs at `http://localhost:5173`.

## Deploy to Vercel

1. Push this repo to GitHub.
2. Import the project in [Vercel](https://vercel.com/new).
3. Framework preset: **Vite** (auto-detected).
4. Add environment variables:
   - `VITE_SUPABASE_URL` — your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` — your Supabase anon/public key
5. Deploy.

`vercel.json` includes SPA rewrites so `/dashboard`, `/admin`, and `/auth` routes work on refresh.

### Supabase auth redirect URLs

In Supabase → Authentication → URL Configuration, add your Vercel production URL and `http://localhost:5173/**` for local dev.

## Database migrations

Run SQL files in `supabase/` against your Supabase project (in order):

1. `schema.sql`
2. `dashboard-schema.sql`
3. `admin-schema.sql`
4. `network-migration.sql`
5. `remove-yellow.sql`
6. `user-topup-migration.sql`
7. `order-export-migration.sql`
8. `order-retry-migration.sql`
9. `order-auto-deliver-migration.sql`
10. `dashboard-orders-migration.sql`

## API

Edge function: `supabase/functions/api` — deploy with:

```bash
npx supabase functions deploy api --project-ref YOUR_REF --no-verify-jwt
```
