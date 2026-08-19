# AlmaLinux v9.8.0 Deployment Guide - AKB Group Accounts (PM2 & Apache Proxy)

This guide provides complete instructions and an automated deployment script for deploying **AKB Group Accounts** on **AlmaLinux 9.8.0 STANDARD KVM Server** for domain **`accounts.akbgroups.com`**.

---

## 📋 Deployment Credentials & Specifications

| Parameter | Value |
|---|---|
| **Operating System** | AlmaLinux v9.8.0 STANDARD (KVM) |
| **Domain** | **`accounts.akbgroups.com`** |
| **Server Application Path** | `/home/accountsakbgroup/public_html/` |
| **cPanel User** | `accountsakbgroup` |
| **Process Manager** | **PM2** |
| **Application Port** | `3020` |
| **Database Engine** | MariaDB / MySQL |
| **Database Name** | `accountsakbgroup_db` |
| **Database Username** | `accountsakbgroup_user` |
| **Database Password** | `bka@6202#db` |
| **Default Admin Email** | `admin@akbgroups.com` |
| **Default Admin Password** | `ChangeMe123!` |

---

## ⚡ Smart Idempotent Automated Deployment (`deploy.sh`)

The [deploy.sh](file:///d:/projects/as_logics/clients/akb_school/akb-accounts/akb-accounts/deploy.sh) script is **smart and idempotent**:
- Checks if Firewalld port `3020/tcp` is already open. If open, skips firewall modification.
- Checks if MariaDB, Node.js, and PM2 are already installed before trying to reinstall.
- Checks if database `accountsakbgroup_db` and user `accountsakbgroup_user` exist.
- Automatically creates and configures the cPanel Apache `proxy.conf` for `accounts.akbgroups.com` and runs `/scripts/rebuildhttpdconf`.
- Safely reloads PM2 without downtime (`pm2 reload akb-accounts`).

Run it on your server at any time:

```bash
cd /home/accountsakbgroup/public_html
chmod +x deploy.sh
./deploy.sh
```

---

## 🌐 cPanel / Apache Reverse Proxy Setup (`accounts.akbgroups.com`)

The exact cPanel Apache file paths for **`accounts.akbgroups.com`** are:

### File Paths:
- **HTTP (Port 80)**:
  `/etc/apache2/conf.d/userdata/std/2_4/accountsakbgroup/accounts.akbgroups.com/proxy.conf`
- **HTTPS (Port 443)**:
  `/etc/apache2/conf.d/userdata/ssl/2_4/accountsakbgroup/accounts.akbgroups.com/proxy.conf`

### File Content (`proxy.conf`):

```apache
<IfModule mod_proxy.c>
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:3020/
    ProxyPassReverse / http://127.0.0.1:3020/
    RequestHeader set X-Forwarded-Proto "https"
    RequestHeader set X-Forwarded-Port "443"
</IfModule>
```

### Rebuild Apache Command:
```bash
/scripts/rebuildhttpdconf
systemctl restart httpd
```

---

## 🛠️ Step-by-Step Manual Deployment (PM2)

### Step 1: Install System Dependencies & PM2
```bash
sudo dnf module enable -y nodejs:20 2>/dev/null || true
sudo dnf install -y curl git mariadb-server mariadb nginx firewalld nodejs
sudo npm install -g pm2
sudo systemctl enable --now mariadb firewalld
```

---

### Step 2: Create MariaDB Database & User
```bash
sudo mysql
```
```sql
CREATE DATABASE IF NOT EXISTS `accountsakbgroup_db` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'accountsakbgroup_user'@'localhost' IDENTIFIED BY 'bka@6202#db';
ALTER USER 'accountsakbgroup_user'@'localhost' IDENTIFIED BY 'bka@6202#db';
GRANT ALL PRIVILEGES ON `accountsakbgroup_db`.* TO 'accountsakbgroup_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

---

### Step 3: Configure Environment `.env`
```bash
cd /home/accountsakbgroup/public_html/

cat <<EOF > .env
DB_HOST=localhost
DB_PORT=3306
DB_USER=accountsakbgroup_user
DB_PASSWORD=bka@6202#db
DB_NAME=accountsakbgroup_db

PORT=3020
NODE_ENV=production
SESSION_SECRET=akb_production_secret_key_change_me_987654321
ADMIN_EMAIL=admin@akbgroups.com
ADMIN_PASSWORD=ChangeMe123!
EOF

chmod 600 .env
```

---

### Step 4: Install Dependencies & Run Database Setup
```bash
cd /home/accountsakbgroup/public_html/
npm install --omit=dev
npm run db:setup
```

---

### Step 5: Start Process with PM2
```bash
cd /home/accountsakbgroup/public_html/
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```

---

### Step 6: Configure Firewalld (Port 3020 Check)
```bash
if sudo firewall-cmd --query-port=3020/tcp; then
    echo "Port 3020 is already open."
else
    sudo firewall-cmd --permanent --add-port=3020/tcp
    sudo firewall-cmd --permanent --add-service=http
    sudo firewall-cmd --permanent --add-service=https
    sudo firewall-cmd --reload
fi
```

---

### Step 7: Configure Apache Proxy for `accounts.akbgroups.com`
```bash
# Create directories
sudo mkdir -p /etc/apache2/conf.d/userdata/std/2_4/accountsakbgroup/accounts.akbgroups.com/
sudo mkdir -p /etc/apache2/conf.d/userdata/ssl/2_4/accountsakbgroup/accounts.akbgroups.com/

# Write proxy.conf
cat <<'EOF' | sudo tee /etc/apache2/conf.d/userdata/std/2_4/accountsakbgroup/accounts.akbgroups.com/proxy.conf /etc/apache2/conf.d/userdata/ssl/2_4/accountsakbgroup/accounts.akbgroups.com/proxy.conf > /dev/null
<IfModule mod_proxy.c>
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:3020/
    ProxyPassReverse / http://127.0.0.1:3020/
    RequestHeader set X-Forwarded-Proto "https"
    RequestHeader set X-Forwarded-Port "443"
</IfModule>
EOF

# Rebuild Apache HTTPD configuration
/scripts/rebuildhttpdconf
systemctl restart httpd
```

---

## 📊 PM2 Commands Summary

| Action | PM2 Command |
|---|---|
| **View Live Logs** | `pm2 logs akb-accounts` |
| **Check App Status** | `pm2 status` |
| **Restart Application** | `pm2 restart akb-accounts` |
| **Reload (Zero Downtime)** | `pm2 reload akb-accounts` |
| **Save State for Boot** | `pm2 save` |
| **Re-run Migrations** | `cd /home/accountsakbgroup/public_html && npm run db:migrate` |


cd /home/accountsakbgroup/public_html
chmod +x deploy.sh
sudo ./deploy.sh
