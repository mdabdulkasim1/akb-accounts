#!/bin/bash
# ==============================================================================
# AKB Group Accounts - Smart Idempotent AlmaLinux 9 Deployment Script (PM2)
# Target Path: /home/accountsakbgroup/public_html/
# Domain: accounts.akbgroups.com
# Port: 3020
# Database: accountsakbgroup_db
# User: accountsakbgroup_user
# Process Manager: PM2
# ==============================================================================

set -e

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=3020
DB_NAME="accountsakbgroup_db"
DB_USER="accountsakbgroup_user"
DB_PASS='bka@6202#db'
APP_NAME="akb-accounts"
DOMAIN="accounts.akbgroups.com"
CPANEL_USER="accountsakbgroup"

echo "======================================================================"
echo "    Deploying AKB Group Accounts on AlmaLinux 9 (Port ${PORT})       "
echo "    Target Directory: ${APP_DIR}                                      "
echo "    Domain: ${DOMAIN}                                                 "
echo "    Process Manager: PM2                                              "
echo "======================================================================"

# 1. System packages & Node.js check (Idempotent)
if command -v node &> /dev/null && command -v mariadb &> /dev/null; then
    echo "[1/7] System dependencies (Node.js, MariaDB) already installed. Skipping package install."
else
    echo "[1/7] Installing missing system dependencies..."
    if command -v dnf &> /dev/null; then
        sudo dnf module enable -y nodejs:20 2>/dev/null || true
        sudo dnf install -y curl git mariadb-server mariadb nginx firewalld nodejs
    fi
fi

# Ensure services are started
if command -v systemctl &> /dev/null; then
    sudo systemctl enable --now mariadb 2>/dev/null || true
    sudo systemctl enable --now firewalld 2>/dev/null || true
fi

# Install PM2 globally if missing
if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2 globally..."
    sudo npm install -g pm2
else
    echo "PM2 process manager is already installed."
fi

# 2. Database & User Setup (Idempotent)
echo "[2/7] Setting up MariaDB database '${DB_NAME}' and user '${DB_USER}'..."
sudo mysql -e "CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>/dev/null || true
sudo mysql -e "CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';" 2>/dev/null || true
sudo mysql -e "CREATE USER IF NOT EXISTS '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASS}';" 2>/dev/null || true
sudo mysql -e "ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';" 2>/dev/null || true
sudo mysql -e "ALTER USER '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASS}';" 2>/dev/null || true
sudo mysql -e "GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';" 2>/dev/null || true
sudo mysql -e "GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'127.0.0.1';" 2>/dev/null || true
sudo mysql -e "FLUSH PRIVILEGES;"

# 3. Environment configuration (Quotes around DB_PASSWORD for special characters like #)
echo "[3/7] Configuring .env file..."
cat <<EOF > "${APP_DIR}/.env"
DB_HOST=localhost
DB_PORT=3306
DB_USER=${DB_USER}
DB_PASSWORD="${DB_PASS}"
DB_NAME=${DB_NAME}

PORT=${PORT}
NODE_ENV=production
SESSION_SECRET=$(openssl rand -hex 32 2>/dev/null || echo "akb-group-accounts-alma9-secret-key-prod")
ADMIN_EMAIL=admin@akbgroups.com
ADMIN_PASSWORD=ChangeMe123!
EOF
chmod 600 "${APP_DIR}/.env"

# 4. Install Node dependencies & run database migrations/seeding
echo "[4/7] Installing NPM packages and running database migrations..."
cd "${APP_DIR}"
npm install --omit=dev
npm run db:setup

# 5. Start / Reload Application with PM2 (Idempotent)
echo "[5/7] Managing application process with PM2..."
if pm2 list | grep -q "${APP_NAME}"; then
    echo "PM2 process '${APP_NAME}' is running. Reloading application..."
    pm2 reload "${APP_NAME}"
else
    echo "Starting '${APP_NAME}' with PM2..."
    pm2 start ecosystem.config.js --env production
fi

pm2 save

# 6. Firewall Check & Update (Idempotent)
echo "[6/7] Checking Firewalld rules for port ${PORT}..."
if command -v firewall-cmd &> /dev/null; then
    if sudo firewall-cmd --query-port=${PORT}/tcp 2>/dev/null | grep -q "yes"; then
        echo "Firewall port ${PORT}/tcp is already open. Skipping firewall modification."
    else
        echo "Opening firewall port ${PORT}/tcp..."
        sudo firewall-cmd --permanent --add-port=${PORT}/tcp 2>/dev/null || true
        sudo firewall-cmd --permanent --add-service=http 2>/dev/null || true
        sudo firewall-cmd --permanent --add-service=https 2>/dev/null || true
        sudo firewall-cmd --reload 2>/dev/null || true
        echo "Firewall updated and reloaded."
    fi
fi

# 7. cPanel Apache Reverse Proxy Check & Config (Idempotent)
STD_DIR="/etc/apache2/conf.d/userdata/std/2_4/${CPANEL_USER}/${DOMAIN}"
SSL_DIR="/etc/apache2/conf.d/userdata/ssl/2_4/${CPANEL_USER}/${DOMAIN}"

if [ -d "/etc/apache2/conf.d/userdata" ] || [ -d "/etc/httpd/conf.d" ]; then
    echo "[7/7] Configuring cPanel Apache proxy.conf for ${DOMAIN}..."
    sudo mkdir -p "${STD_DIR}" "${SSL_DIR}"
    
    cat <<'EOF' | sudo tee "${STD_DIR}/proxy.conf" "${SSL_DIR}/proxy.conf" > /dev/null
<IfModule mod_proxy.c>
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:3020/
    ProxyPassReverse / http://127.0.0.1:3020/
    RequestHeader set X-Forwarded-Proto "https"
    RequestHeader set X-Forwarded-Port "443"
</IfModule>
EOF

    if [ -x "/scripts/rebuildhttpdconf" ]; then
        echo "Rebuilding Apache HTTPD configuration via /scripts/rebuildhttpdconf..."
        sudo /scripts/rebuildhttpdconf 2>/dev/null || true
        sudo systemctl restart httpd 2>/dev/null || true
    elif command -v rebuildhttpdconf &> /dev/null; then
        echo "Rebuilding Apache HTTPD configuration..."
        sudo rebuildhttpdconf 2>/dev/null || true
        sudo systemctl restart httpd 2>/dev/null || true
    fi
fi

echo "======================================================================"
echo "    DEPLOYMENT / UPDATE SUCCESSFUL!                                   "
echo "    Application directory: ${APP_DIR}                                 "
echo "    Domain: ${DOMAIN}                                                 "
echo "    Application running on port: ${PORT}                              "
echo "    PM2 Status: pm2 status                                            "
echo "    PM2 Logs: pm2 logs ${APP_NAME}                                     "
echo "======================================================================"
