# WorldTour accounts server

Express + MongoDB Atlas API for signed-in travellers: profiles, profile photos, saved trips with every
prompt and every generated itinerary, history, sharing and settings. Sign-in is handled by **Clerk**,
photos are stored on **Cloudinary**. The trip planner itself stays in `ai/`; the website (`frontend/`)
talks to both.

```
Browser ── Clerk (sign-up, sign-in, email codes, Google)
   ├────── ai/      chat + planning (unchanged)
   └────── server/  this API: users, trips, versions, history, sharing  ── MongoDB Atlas, Cloudinary
```

Passwords are never stored here: Clerk keeps them. "Confirm password" is checked in the sign-up form.

## Run locally

```bash
cd server
npm install
# fill in server/.env (see .env.example)
npm run dev          # http://localhost:5000/api/health
npm test             # 14 API tests on a temporary in-memory MongoDB
```

For the website to use it locally, set in `frontend/.env`:
`VITE_SERVER_URL=http://localhost:5000` and `VITE_CLERK_PUBLISHABLE_KEY=pk_test_...`.

## API

All routes except health and shared trips need `Authorization: Bearer <Clerk session token>`.

| Route | What it does |
|---|---|
| `GET /api/health` | Status and which services are configured (never the keys) |
| `GET /api/me` · `PATCH /api/me` | Your profile · update name, phone, preferences |
| `POST /api/me/onboarding` · `POST /api/me/refresh` | Photo step done · re-read name/email from Clerk |
| `POST /api/me/photo/sign` · `PATCH /api/me/photo` · `DELETE /api/me/photo` | Signed Cloudinary upload · save · remove |
| `DELETE /api/me` | Delete the account, its trips and photo (and the Clerk user) |
| `GET /api/trips` | History: `search`, `favorite`, `status`, `sort`, `page`, `limit` |
| `POST /api/trips` · `PUT /api/trips/:id/sync` | Save a trip snapshot (messages, chat session, plan, picks); a new plan becomes a new version |
| `GET /api/trips/:id` · `GET /api/trips/:id/versions/:versionId` | Trip with conversation and version list · one version's plan |
| `PATCH /api/trips/:id` · `DELETE /api/trips/:id` | Rename, favourite, notes, archive · delete |
| `POST /api/trips/:id/share` · `DELETE /api/trips/:id/share` | Turn the read-only share link on · off |
| `GET /api/share/:shareId` | Public read-only shared trip (no conversation, no account details) |
| `GET /api/stats` | Numbers for the profile page |
| `POST /api/webhooks/clerk` | Clerk `user.created/updated/deleted`, signature-checked |

## Deploy (Vercel) — step by step

### 1. MongoDB Atlas (free M0)
1. Create a project and a **M0** cluster.
2. **Database Access** → add a database user (username + password).
3. **Network Access** → add `0.0.0.0/0` (Vercel's addresses change, so a fixed list does not work).
4. **Connect → Drivers** → copy the string, put your password in it, and add the database name before `?`:
   `mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/worldtour?retryWrites=true&w=majority` → `MONGODB_URI`.

### 2. Clerk
1. Create an application; sign-in options: **Email** + **Password**, and **Google**.
2. Under **User & authentication**, keep *phone number* off as a sign-in method (the phone is saved on the
   WorldTour profile instead), and leave *username* off.
3. **API keys** → copy the **Publishable key** (`pk_...`) and **Secret key** (`sk_...`).
4. Note: Clerk *production* instances need a domain you own. On `*.vercel.app` use the **Development**
   instance keys (`pk_test_` / `sk_test_`); they work on the live site with a small "Development mode" badge.
   When you add your own domain, create the production instance and swap the keys.

### 3. Cloudinary
Dashboard → **Product environment credentials** → Cloud name, API key, API secret.

### 4. Vercel — new project for this folder
1. **Add New → Project** → import the same GitHub repo → **Root Directory: `server`** → Framework: *Other*.
2. **Environment Variables** — add every name from `.env.example` with your values:
   `MONGODB_URI`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
   `CLOUDINARY_API_SECRET`, `CLOUDINARY_FOLDER`, `ALLOWED_ORIGINS=https://worldtour-xi.vercel.app`,
   `APP_URL=https://worldtour-xi.vercel.app`.
3. Deploy, then open `https://<server>.vercel.app/api/health` → `"database": "connected"`, `"clerk": true`, `"cloudinary": true`.

### 5. Clerk webhook (keeps the database in step with Clerk)
Clerk → **Webhooks** → **Add endpoint** `https://<server>.vercel.app/api/webhooks/clerk`, events
`user.created`, `user.updated`, `user.deleted` → copy the **Signing secret** (`whsec_...`) into
`CLERK_WEBHOOK_SIGNING_SECRET` on Vercel → **Redeploy** the server. Health then shows `"clerkWebhook": true`.

### 6. Frontend project on Vercel (existing `worldtour-xi`)
Settings → Environment Variables → add
`VITE_SERVER_URL=https://<server>.vercel.app` and `VITE_CLERK_PUBLISHABLE_KEY=pk_...` → **Redeploy**.
(`VITE_API_URL` stays as it is.) Until these are set, the site keeps working guest-only.

### 7. AI project on Vercel (existing `world-tour-nine`)
No new keys. Set `ALLOWED_ORIGINS=https://worldtour-xi.vercel.app` so only your site can use the planner → **Redeploy**.

### 8. Check
Sign up on the site → enter the email code → add a photo → plan a trip → open **My trips**: the trip shows
the conversation and an itinerary version; change something ("premium", "5 days") and a second version appears.
