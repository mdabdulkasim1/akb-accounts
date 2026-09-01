# Deploying AKB Group Accounts to Railway.com (with your Own MySQL Database)

This guide explains how to deploy **AKB Group Accounts** on **Railway.com** using GitHub CI/CD, connected directly to **your own MySQL/MariaDB database** (e.g. hosted on your VPS/AlmaLinux/cPanel server or custom host).

---

## 🛠️ Phase 1 — Prepare your Server's MySQL Database for Remote Access

If your MySQL/MariaDB database is running on your own server (e.g. `accounts.akbgroups.com` or server IP `x.x.x.x`), Railway's cloud app needs permission to connect to it.

### 1. Ensure MariaDB/MySQL is listening to Remote Connections
In `/etc/my.cnf` or `/etc/my.cnf.d/mariadb-server.cnf` on your server:
```ini
[mysqld]
bind-address = 0.0.0.0
```
*(If `bind-address` was `127.0.0.1`, change it to `0.0.0.0` or comment it out)*

Restart MariaDB:
```bash
sudo systemctl restart mariadb
```

### 2. Grant Access to your Database User for Remote Connections (`%`)
Connect to MySQL on your server as root:
```bash
sudo mysql -u root
```
Run the following SQL commands to grant remote access to your database user:
```sql
-- Replace 'accountsakbgroup_user', 'accountsakbgroup_db', and 'bka@6202#db' with your actual credentials
GRANT ALL PRIVILEGES ON `accountsakbgroup_db`.* TO 'accountsakbgroup_user'@'%' IDENTIFIED BY 'bka@6202#db';
FLUSH PRIVILEGES;
EXIT;
```

### 3. Open MySQL Port (3306) in your Server Firewall
Allow incoming connections on port `3306`:
```bash
sudo firewall-cmd --permanent --add-port=3306/tcp
sudo firewall-cmd --reload
```
*(If using AWS/DigitalOcean/Hetzner, also ensure port `3306` is allowed in your Cloud Security Group / Firewall rules)*.

---

## 🚀 Phase 2 — Deploy App to Railway.com

### Step 1: Push Code to GitHub
1. Create a private repository on GitHub (e.g. `akb-accounts`).
2. Push your project code to GitHub:
   ```bash
   git init
   git add .
   git commit -m "Prepare for Railway deployment"
   git remote add origin https://github.com/YOUR_USERNAME/akb-accounts.git
   git push -u origin main
   ```

### Step 2: Create a New Service on Railway
1. Log in to [Railway.com](https://railway.com).
2. Click **New Project** → **Deploy from GitHub repo**.
3. Select your `akb-accounts` repository.
4. Railway will automatically detect Node.js (via `NIXPACKS` builder) and `railway.json`.

---

## ⚙️ Phase 3 — Configure Environment Variables on Railway

1. In Railway, click on your deployed **akb-accounts** service.
2. Navigate to the **Variables** tab.
3. Click **+ Add Variable** or **Raw Editor** and set the following environment variables:

| Variable Name | Example Value | Description |
|---|---|---|
| `DB_HOST` | `accounts.akbgroups.com` *(or your server IP)* | Host domain or IP of your own MySQL database |
| `DB_PORT` | `3306` | MySQL port |
| `DB_USER` | `accountsakbgroup_user` | MySQL username |
| `DB_PASSWORD` | `bka@6202#db` | MySQL password |
| `DB_NAME` | `accountsakbgroup_db` | MySQL database name |
| `SESSION_SECRET` | `a_long_random_secure_secret_string_12345` | Secret for cookie session encryption |
| `ADMIN_EMAIL` | `admin@akbgroups.com` | Email for default admin user |
| `ADMIN_PASSWORD` | `ChangeMe123!` | Initial password for admin user |
| `NODE_ENV` | `production` | Set to production |

*(Alternative: You can use `MYSQL_URL=mysql://accountsakbgroup_user:bka%406202%23db@accounts.akbgroups.com:3306/accountsakbgroup_db` instead of individual `DB_*` variables).*

---

## 🌐 Phase 4 — Generate Public Domain & Verify

1. Go to **Settings** → **Networking** → click **Generate Domain** (e.g. `akb-accounts-production.up.railway.app`).
2. Alternatively, click **Custom Domain** and map your own domain (e.g. `accounts.akbgroups.com`) via a CNAME record.
3. Railway automatically triggers a redeploy.
4. Open the generated domain link.
5. On startup, `server.js` automatically runs database migrations (`schema_migrations`) and seeds initial tables if needed.
6. Log in with your `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

---

## 🔄 Optional: Using Railway's Provisioned MySQL Database instead

If you prefer to host the MySQL database inside Railway instead of your own server:
1. In your Railway project, click **+ Create** → **Database** → **Add MySQL**.
2. Railway will create a MySQL database and generate variables: `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`, `MYSQLDATABASE`.
3. In your `akb-accounts` service, link the database or add variable:
   - `MYSQL_URL` = `${{MySQL.MYSQL_URL}}`
4. Redeploy the app.

---

## ❓ Troubleshooting

| Issue | Solution |
|---|---|
| `connect ETIMEDOUT` or `ECONNREFUSED` | Your server firewall is blocking port `3306` or MariaDB is bound to `127.0.0.1`. Verify `bind-address = 0.0.0.0` and `firewall-cmd --add-port=3306/tcp`. |
| `Access denied for user ...@'...'` | The MySQL user does not have `%` host access permissions. Run `GRANT ALL PRIVILEGES ON database.* TO 'user'@'%'; FLUSH PRIVILEGES;` on your server. |
| Healthcheck failure | Ensure `/healthz` endpoint responds on port designated by Railway (`PORT` env variable). |
