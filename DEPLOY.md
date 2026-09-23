# Putting Relo OS online (Vercel)

About 15 minutes. You click; nothing here needs code.

## 0. Make the plan signing secret (once)
The app signs every AI plan so nobody can save a hand-written one. The live database and
Vercel share one secret:
1. Supabase → project **Relo OS** → **SQL Editor** → **New query**.
2. Paste `select private.new_plan_signing_secret();` and click **Run**.
3. Copy the long value it shows. It goes into Vercel as `PLAN_SIGNING_SECRET` (step 2).
   Don't paste it anywhere else. Running it again makes a new one (then update Vercel too).

## 1. Import the project
1. Go to vercel.com, sign in with GitHub.
2. **Add New… → Project**, choose **nikhin2812/Relo-OS**, click **Import**
   (allow Vercel access to that repository if asked).
3. Leave the build settings as they are (Next.js is detected automatically).

## 2. Add the settings (Environment Variables), then Deploy
| Name | Value | Needed? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://kevwftukmiwpekbuoera.supabase.co` | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_5hifOdenFS0mfQgxa9JMWg_0ZVAB93f` | Yes |
| `NEXT_PUBLIC_APP_URL` | your site address, e.g. `https://relo-os.yourdomain.com` (no slash at the end) | Yes |
| `PLAN_SIGNING_SECRET` | from step 0 below | Yes (without it, new plans can't be saved) |
| `ANTHROPIC_API_KEY` | your Anthropic key | For AI plans on new requests |
| `RESEND_API_KEY` | your Resend key | For emailing providers |
| `EMAIL_FROM` | e.g. `Relo OS <workorders@yourdomain.com>` (a domain verified in Resend) | With Resend |

Choose **Type: Config** for the three `NEXT_PUBLIC_…` settings (they are public by design;
Vercel hides "Secret" values from them, which breaks the build). Use **Secret** for the others.

Do **not** add `PLANNER_MODE`, `DEMO_PASSWORD` or any Supabase secret/service-role key — the app doesn't need them.
Click **Deploy**. You'll get a `…vercel.app` address in a minute or two.

If you don't have your domain ready yet, set `NEXT_PUBLIC_APP_URL` to the `…vercel.app` address for now and change it later (then click **Redeploy**).

## 3. Connect your domain
1. In the project: **Settings → Domains → Add**, type your domain.
2. Vercel shows one or two DNS records. Add them where you bought the domain.
3. Wait for the green tick (minutes to a few hours). HTTPS is set up for you.
4. Make sure `NEXT_PUBLIC_APP_URL` matches the domain, then **Redeploy**.

## 4. One Supabase setting
Supabase → **Authentication → URL Configuration → Site URL** = your site address.

## 5. Tell Claude the address
Claude checks the live site and signs in as each demo role.
