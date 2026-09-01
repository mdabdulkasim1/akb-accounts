# AKB Group Accounts

Internal expense and income system for the five group companies:
AKB Construction · Samiha Polyclinic and Diagnostics · Samiha Pharmacy · Royal Dryfruits · AKB Rental.

One shared MySQL/MariaDB database, so everyone signed in sees the same figures at the same time.

## The payment approval flow

1. **Staff raises a payment request** — company, work or purpose, party, invoice number and date, expense category, amount required, normal or urgent, and a note for the approver.
2. **The administrator reviews it** — the requested amount is shown, and the approved amount can be changed up or down before approving. A note can be added. Or the request is rejected with a reason.
3. **The accountant releases it** — picks the payment date, method and reference. Releasing automatically posts a paid expense entry for the approved amount against that company, linked back to the request.
4. Everything is stamped with who raised, who approved (and the original amount if it was revised), and who released it.

## What it does

- **Payments** — the request → approve → release queue above, with a badge showing what is waiting for you.
- **Cash** — the accountant keeps the cash register: every rupee received is entered with **date, company, amount and source of money** (counter sales, collection from a customer, cash drawn from the bank, capital introduced, loan, transfer from another group company…), plus an optional reference and note. Cash paid out is picked up automatically from expenses settled in cash, including payments released from an approved request. Cash in hand is then *last count + received since − paid out since*, per company. A periodic physical count re-bases the figure and shows the difference against the books.
  - A receipt that is business income (counter sales, customer collection) can be ticked as income — the app writes the income entry at the same time, so the books and the cash box move together and nothing is entered twice.
  - Cash income typed straight into Transactions instead of the cash register is flagged at the top of the Cash page, so it cannot silently go missing from the cash balance.
- **Transactions** — income and expense entries per company, with party, invoice number, payment method, paid/unpaid status, notes and who entered it.
- **Dashboard** — group and per-company totals, income vs expense by company, monthly trend, top expense categories, receivables and payables.
- **Inter-company** — transfers between the five companies, with a due-from / due-to matrix and a zero-balance group check. Administrators only.
- **Reports** — consolidated P&L, category breakdown by company, unpaid receivables and payables with ageing, and party statements. Each exports to CSV.
- **People** — administrator and staff accounts. Staff only see the companies you tick and cannot delete anything.
- **Audit trail** — sign-ins, entry additions, edits and deletions.

## Roles

| | Administrator | Accountant | Staff |
|---|---|---|---|
| See all five companies | yes | yes | only the ones assigned |
| Raise a payment request | yes | yes | yes |
| **Approve / reject / change the amount** | **yes** | no | no |
| **Release an approved payment** | yes | **yes** | no |
| **Record cash received & cash counts** | yes | **yes** | no |
| Add and edit entries | yes | yes | yes, within their companies |
| Delete entries | yes | no | no |
| Terminate account / reset roles | yes | no | no |
| Inter-company transfers | yes | not visible | not visible |
| Manage people, companies, categories, settings | yes | no | no |
| Change own password | yes | yes | yes |

## Environment variables

| Name | Required | Purpose |
|---|---|---|
| `DB_HOST` / `MYSQLHOST` | yes | MySQL server host IP or domain name (e.g. `accounts.akbgroups.com`) |
| `DB_PORT` / `MYSQLPORT` | optional | MySQL port (default `3306`) |
| `DB_USER` / `MYSQLUSER` | yes | Database user name |
| `DB_PASSWORD` / `MYSQLPASSWORD` | yes | Database user password |
| `DB_NAME` / `MYSQLDATABASE` | yes | Database name |
| `MYSQL_URL` | alternative | Full connection URL `mysql://user:pass@host:3306/dbname` |
| `SESSION_SECRET` | yes | Long random string used to sign the login cookie |
| `ADMIN_EMAIL` | first boot | Email of the first administrator account |
| `ADMIN_PASSWORD` | first boot | Password for that account (change it after signing in) |
| `ADMIN_NAME` | optional | Display name of the first administrator |
| `NODE_ENV` | yes in production | Set to `production` so the login cookie is marked secure |
| `PORT` | no | Set automatically by Railway |

## Database Management & Deployment Commands

You can run migration and seeding scripts manually or during deployment:

```bash
# Run both migrations and initial data seeding with detailed logs:
npm run db:setup

# Run table migrations only:
npm run db:migrate

# Run data seeder only (companies, categories, admin user):
npm run db:seed
```

Alternatively, you can import the raw MySQL schema directly:
```bash
mysql -u root -p akb-accounts < schema.sql
```

## Running locally

```bash
npm install
cp .env.example .env      # then edit the values
npm run db:setup          # optional: run explicitly before start
npm start                 # http://localhost:3000
```

## Deploying

See `DEPLOY.md` for the full Railway walkthrough.

## Backups

Railway's Postgres can take scheduled backups from the database service page.
In addition, **Settings → Data → Export everything** downloads a JSON snapshot,
and **Export all entries** downloads a CSV for your accountant.
