# Quick Docker bring-up

Spin up Postgres + slskd + Transmission with one command. Doesn't include Jellyfin (heavy / opinionated).

```bash
docker compose up -d
```

Then run `npm run setup` and answer the Postgres prompts with `localhost:5432`, user `postgres`, password `workshop` (matches `docker-compose.yml`).

See [docker-compose.yml](../../docker-compose.yml) at the repo root.
