# Putting the app online — step by step

Total time about 15 minutes. You need a phone and an email address.
Nothing here requires any coding.

---

## Part 1 — Create a GitHub account (5 minutes)

GitHub stores the code. Railway reads it from there and rebuilds the app whenever
the code changes.

1. Go to **https://github.com/signup**
2. Enter your email, choose a password, and pick a username (for example `akbgroup`).
3. Verify the puzzle, then enter the 6-digit code emailed to you.
4. Skip the personalisation questions and choose the **Free** plan.

## Part 2 — Put the code on GitHub (5 minutes, no commands)

1. Unzip **akb-accounts.zip** on your computer. You should see `server.js`,
   `package.json`, a `public` folder and the rest.
2. On GitHub click the **+** at the top right → **New repository**.
3. Name it `akb-accounts`. Choose **Private**. Do **not** tick "Add a README".
   Click **Create repository**.
4. On the next page click the link **uploading an existing file**.
5. Open the unzipped folder, select everything inside it, and drag it all into the
   browser window. Wait for the uploads to finish.
   - If a `node_modules` folder exists, do **not** upload it. It is rebuilt automatically.
6. Click **Commit changes**.

## Part 3 — Create the Railway project (5 minutes)

1. Go to **https://railway.com** and click **Login** → **Login with GitHub**, then
   authorise Railway.
2. Railway asks for a plan. Choose **Hobby ($5 / month)** and add your card.
   The trial credit may cover the first month.
3. Click **New Project** → **Deploy from GitHub repo** → select `akb-accounts`.
   Railway will start building. Let it run.
4. In the same project click **+ Create** → **Database** → **Add PostgreSQL**.
   Wait until it shows *Deployed*.

## Part 4 — Connect the app to the database

1. Click your **akb-accounts** service (not the database) → **Variables** tab.
2. Add these one at a time with **+ New Variable**:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` — type it exactly, Railway fills it in |
   | `SESSION_SECRET` | a long random string, e.g. 40 mixed characters you mash out |
   | `ADMIN_EMAIL` | your email address |
   | `ADMIN_PASSWORD` | a strong password you will use to sign in first |
   | `NODE_ENV` | `production` |

3. Click **Deploy** / **Redeploy** when Railway offers it.

## Part 5 — Open it

1. Still on the app service, go to **Settings** → **Networking** →
   **Generate Domain**. Accept the suggested port (Railway detects it).
2. Railway gives you an address like
   `https://akb-accounts-production.up.railway.app`. Open it.
3. Sign in with the `ADMIN_EMAIL` and `ADMIN_PASSWORD` you set.
4. First things to do:
   - **Settings → My account** — change your password.
   - **Settings → People → + Add person** — create the staff logins and tick which
     companies each one may see.
   - **Settings → Companies** — correct any company name or code.

Bookmark the address on your phone. It works as a normal website on any device.

---

## Optional — your own domain

In **Settings → Networking → Custom Domain**, enter something like
`accounts.yourcompany.com`. Railway shows a CNAME record; add it at your domain
registrar. HTTPS is issued automatically.

## Cost

- Railway Hobby: **$5 / month** of usage credit included.
- This app plus a small Postgres normally stays inside that credit.
- Watch **Usage** in the Railway dashboard for the first month.

## Backups

1. In Railway click the **Postgres** service → **Backups** → enable scheduled backups.
2. Separately, once a month use **Settings → Data → Export everything** in the app
   and keep the file somewhere safe. That file is readable without Railway.

## If something goes wrong

| Symptom | Fix |
|---|---|
| Build fails | Open the **Deploy logs**. Usually `package.json` was not uploaded to the repository root. |
| "DATABASE_URL is not set" in the logs | The variable is missing or mistyped. It must be exactly `${{Postgres.DATABASE_URL}}` |
| Page loads but sign-in fails | `ADMIN_EMAIL` / `ADMIN_PASSWORD` were added *after* the first successful boot, so the account was created with the defaults. Open the Postgres service → **Data** → delete the row in `users`, then redeploy. |
| Signed out immediately after signing in | `NODE_ENV` is `production` but the site was opened over `http://`. Use the `https://` address. |

## Updating the app later

Edit the file on GitHub (pencil icon) and commit, or upload a replacement file.
Railway rebuilds and redeploys within a minute or two. Your data is untouched —
it lives in Postgres, not in the code.
