# Postgres

The workshop uses one database (`workshop`) and three scoped roles:

- `workshop` — read/write for the web app and migrations
- `soulseek_ingest` — for the Soulseek staging daemon
- `challenge_poller` — for the LoL challenge scraper

All three are created automatically by `npm run setup` with random 32-hex passwords. You only need this guide if you're installing Postgres from scratch or rotating credentials.

## Install (Debian/Ubuntu)

```bash
sudo apt-get install -y postgresql-16 postgresql-client-16
sudo systemctl enable --now postgresql
```

macOS:

```bash
brew install postgresql@16 && brew services start postgresql@16
```

## Run setup

```bash
npm run setup
# Prompts for: host, port, superuser (default postgres), superuser password
# Creates the workshop DB if missing, the three roles if missing, and applies
# all migrations. Re-running is safe.
```

## Adding a migration

Drop a numbered `.sql` file into `scripts/migrations/` (e.g. `009-foo.sql`) and run:

```bash
npm run db:migrate
```

The runner records each applied filename in `_migrations` and skips re-applies.

## Verify

```bash
psql -h localhost -U workshop workshop -c '\dt'
# → 8+ tables
```
