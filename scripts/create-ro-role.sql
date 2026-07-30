-- The wall that generated SQL runs behind. Run once, as a superuser, against bird:
--
--   psql "$DATABASE_URL" -f scripts/create-ro-role.sql
--
-- Then put the role's connection string in .env as DATABASE_URL_RO:
--   postgresql://queryproof_ro:ro_devpass@localhost:5433/bird
--
-- Re-runnable: every statement below is safe to apply a second time.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'queryproof_ro') THEN
    CREATE ROLE queryproof_ro LOGIN PASSWORD 'ro_devpass';
  END IF;
END
$$;

REVOKE ALL ON DATABASE bird FROM queryproof_ro;
GRANT CONNECT ON DATABASE bird TO queryproof_ro;

REVOKE ALL ON SCHEMA public FROM queryproof_ro;
GRANT USAGE ON SCHEMA public TO queryproof_ro;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM queryproof_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO queryproof_ro;

-- Tables loaded after this script still arrive read-only.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO queryproof_ro;
