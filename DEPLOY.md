# Vercel deployment guide

## Your values (copy these into Vercel)

| Variable | Value |
|----------|-------|
| `VITE_SUPABASE_URL` | `https://ihrvvniomtoofrjkmalb.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | *(from Supabase dashboard → Settings → API → anon public key)* |

**Production URL:** Use the URL shown in your Vercel project dashboard after deploy (e.g. `https://your-project.vercel.app`).

**GitHub repo:** https://github.com/adabahjunior/swiftdata-reseller

**Supabase dashboard:** https://supabase.com/dashboard/project/ihrvvniomtoofrjkmalb

---

## Step-by-step: Deploy on Vercel

1. Go to https://vercel.com/new
2. Import **`adabahjunior/swiftdata-reseller`**
3. Framework: **Vite**
4. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for **Production**, **Preview**, and **Development**
5. Deploy

### Supabase auth redirect URLs

In Supabase → **Authentication** → **URL Configuration**, add your Vercel URL:

- Site URL: `https://your-project.vercel.app`
- Redirect URLs: `https://your-project.vercel.app/**` and `http://localhost:5173/**`

---

## Pushing updates

```bash
git push origin master
```

Vercel redeploys automatically when GitHub is connected.
