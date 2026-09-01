# Deploying AKB Group Accounts on Railway.com (with Railway MySQL Database)

This project is configured for **100% automated deployment on Railway.com** using Railway's built-in **MySQL database plugin**.

---

## 🚀 3-Minute Step-by-Step Railway Deployment Guide

### Step 1: Create a Railway Project & Add MySQL Database
1. Go to **[Railway.com](https://railway.com)** and log in.
2. Click **New Project**.
3. Select **Database** → **Add MySQL**.
   *(Railway will provision a managed MySQL database instance for you in seconds).*

---

### Step 2: Deploy the `akb-accounts` Application
1. In the same Railway project canvas, click **+ Create** (top right).
2. Select **GitHub Repo** → choose your **`akb-accounts`** repository.
3. Railway will automatically build the Node.js application using `railway.json`.

---

### Step 3: Connect Application to Railway MySQL Database
1. Click your **`akb-accounts`** service box on the Railway canvas.
2. Go to the **Variables** tab.
3. Click **+ New Variable** → **Add Reference** → select **`MySQL.MYSQL_URL`** (or set `MYSQL_URL` = `${{MySQL.MYSQL_URL}}`).
4. Add the following app environment variables:

| Variable Name | Value | Purpose |
|---|---|---|
| `MYSQL_URL` | `${{MySQL.MYSQL_URL}}` | Connects app directly to Railway MySQL |
| `SESSION_SECRET` | `a_long_random_secure_secret_key_12345` | Encrypts login sessions |
| `ADMIN_EMAIL` | `admin@akbgroups.com` | Email for your administrator login |
| `ADMIN_PASSWORD` | `ChangeMe123!` | Password for first sign-in |
| `NODE_ENV` | `production` | Enables secure cookies |

---

### Step 4: Generate Public URL
1. Still in your **`akb-accounts`** service, go to **Settings** → **Networking**.
2. Click **Generate Domain** (e.g. `akb-accounts-production.up.railway.app`) or attach your own custom domain.
3. Railway will trigger a deployment.

---

### 🔍 Verification & Diagnostics

Once deployed:
- Visit `https://your-railway-app.up.railway.app/api/dbcheck` in your browser.
- It will return:
  ```json
  {
    "status": "connected",
    "userCount": 1
  }
  ```
- Now visit `https://your-railway-app.up.railway.app` and sign in with your `ADMIN_EMAIL` and `ADMIN_PASSWORD`!
