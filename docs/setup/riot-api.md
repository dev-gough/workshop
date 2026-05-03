# Riot API

Powers `/projects/challenges` (LoL challenge tracker).

## Get an API key

1. Sign in at <https://developer.riotgames.com/>.
2. Generate a **Development API Key** (24h TTL) for testing, or apply for a **Personal API Key** (long-lived) for self-hosted use.

## Wire it up

In `/setup` → **Riot API**, enter:

- API Key: `RGAPI-…`
- Summoner Name: in-game name (without `#` tag)
- Tag Line: the `#XXX` suffix (e.g. `NA1`)
- Region: `na1`, `euw1`, `kr`, etc.

Click **Test connection** — the workshop hits `account-v1` to verify the key works and the summoner exists.

## Background poller

The `challenge-poller` systemd service polls every 5 minutes for new matches and challenge progress. Install it via `bash scripts/install-systemd.sh`.

## Initial sync

After connecting, run the one-shot full sync:

```bash
npm run sync-challenges
```

This pulls all challenge configs (~1000) and your current progress.
