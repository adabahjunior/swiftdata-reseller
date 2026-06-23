# Vercel deployment guide

## Your values (copy these into Vercel)

| Variable | Value |
|----------|-------|
| `VITE_SUPABASE_URL` | `https://ihrvvniomtoofrjkmalb.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlocnZ2bmlvbXRvb2ZyamttYWxiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNzE5MTYsImV4cCI6MjA5Nzc0NzkxNn0.QNNalk5DNt7ThVzSLPbWk0-0ZKSBUvDx_ObQOpXTEuI` |

**Production URL (after deploy):** `https://swiftdata-reseller.vercel.app`

**GitHub repo:** https://github.com/adabahjunior/swiftdata-reseller

**Supabase dashboard:** https://supabase.com/dashboard/project/ihrvvniomtoofrjkmalb

---

## Step-by-step: Deploy on Vercel

### 1. Import the project

1. Go to https://vercel.com/new
2. Click **Import** next to `adabahjunior/swiftdata-reseller`
3. If prompted, connect your GitHub account

### 2. Configure the project

- **Framework Preset:** Vite (auto-detected)
- **Root Directory:** `./` (default)
- **Build Command:** `npm run build`
- **Output Directory:** `dist`

### 3. Add environment variables

Before clicking Deploy, expand **Environment Variables** and add:

```
VITE_SUPABASE_URL = https://ihrvvniomtoofrjkmalb.supabase.co
VITE_SUPABASE_ANON_KEY = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlocnZ2bmlvbXRvb2ZyamttYWxiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNzE5MTYsImV4cCI6MjA5Nzc0NzkxNn0.QNNalk5DNt7ThVzSLPbWk0-0ZKSBUvDx_ObQOpXTEuI
```

Apply to: **Production**, **Preview**, and **Development**.

### 4. Deploy

Click **Deploy**. Wait ~1–2 minutes for the build to finish.

Your live URL will be something like:
- `https://swiftdata-reseller.vercel.app`
- or `https://swiftdata-reseller-adabahjunior.vercel.app`

### 5. Supabase auth (already configured)

Supabase redirect URLs have been set to allow:

- `http://localhost:5173/**` (local dev)
- `https://swiftdata-reseller.vercel.app/**` (production)
- `https://swiftdata-reseller-*.vercel.app/**` (preview deploys)

If your Vercel URL is different, add it in Supabase → **Authentication** → **URL Configuration** → **Redirect URLs**.

### 6. Verify

1. Open your Vercel URL
2. Sign up / sign in
3. Check `/dashboard` and `/admin` (admin users only)

---

## Optional: CLI deploy

```bash
npm i -g vercel
vercel login
cd "C:\Users\l\Documents\swiftapi users"
vercel --prod
```

When prompted for env vars, paste the values from the table above.

---

## Pushing future changes

```bash
git add .
git commit -m "Your message"
git push origin master
```

Vercel auto-redeploys on every push to `master`.
