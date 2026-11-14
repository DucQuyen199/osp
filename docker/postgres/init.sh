#!/bin/sh
set -eu

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -v app_user="$OSP_DB_USER" \
  -v app_password="$OSP_DB_PASSWORD" \
  -v app_db="$POSTGRES_DB" <<'SQL'
CREATE ROLE :"app_user"
  LOGIN
  NOSUPERUSER
  NOBYPASSRLS
  PASSWORD :'app_password';
ALTER DATABASE :"app_db" OWNER TO :"app_user";
SQL
