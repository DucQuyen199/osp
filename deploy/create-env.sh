#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

if [ -e .env ]; then
  printf '%s\n' '.env already exists; leaving it unchanged.' >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  printf '%s\n' 'openssl is required to generate database passwords.' >&2
  exit 1
fi

umask 077
admin_password=$(openssl rand -hex 32)
app_password=$(openssl rand -hex 32)

cat > .env <<EOF
OSP_DB_NAME=osp
OSP_DB_USER=osp_app
POSTGRES_ADMIN_USER=postgres
POSTGRES_ADMIN_PASSWORD=$admin_password
OSP_DB_PASSWORD=$app_password
OSP_BIND_ADDRESS=127.0.0.1
OSP_PORT=3000
OSP_DEMO=0
OSP_SIGNUP=1
# Set the public HTTPS origin to enable password-reset links.
OSP_PUBLIC_URL=
OSP_OUTBOX_INTERVAL_SEC=2
OSP_COMM_INTERVAL_SEC=5
# Optional HTTPS e-invoice REST provider; queued e-invoices remain pending when unset.
OSP_EINVOICE_INTERVAL_SEC=5
OSP_EINVOICE_PROVIDER=
OSP_EINVOICE_ENDPOINT=
OSP_EINVOICE_TOKEN=
OSP_EINVOICE_TIMEOUT_SEC=30
# Optional HTTPS notification providers; the worker leaves messages queued when unset.
OSP_COMM_EMAIL_ENDPOINT=
OSP_COMM_EMAIL_TOKEN=
OSP_COMM_EMAIL_FROM=
# Optional SMTP email transport: implicit_tls (465) or starttls (587); email From is shared above.
OSP_COMM_SMTP_HOST=
OSP_COMM_SMTP_PORT=
OSP_COMM_SMTP_MODE=implicit_tls
OSP_COMM_SMTP_USERNAME=
OSP_COMM_SMTP_PASSWORD=
OSP_COMM_SMS_ENDPOINT=
OSP_COMM_SMS_TOKEN=
OSP_COMM_SMS_FROM=
EOF

chmod 600 .env
printf '%s\n' 'Created .env with separate random database passwords (mode 600).'
printf '%s\n' 'Signup is temporarily enabled for first-tenant setup; disable it after creating the first admin.'
