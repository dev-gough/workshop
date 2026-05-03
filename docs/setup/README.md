# Setup guides

Per-service install + configuration docs. Run `npm run setup` first — it handles Postgres roles, migrations, and the Python venv automatically. The guides below walk through the optional external services that the in-app `/setup` page connects to.

| Service | Used by | Doc |
|---|---|---|
| Postgres | everything | [postgres.md](postgres.md) |
| slskd | `/projects/soulseek`, music ingest | [slskd.md](slskd.md) |
| Transmission | `/projects/jellyfin` (torrent fetcher) | [transmission.md](transmission.md) |
| Jellyfin | `/projects/jellyfin` status pings | [jellyfin.md](jellyfin.md) |
| Riot API | `/projects/challenges` | [riot-api.md](riot-api.md) |
| Music library | `/projects/barfoo`, `/projects/soulseek` | [music-library.md](music-library.md) |
| Minecraft RCON | `/projects/server` console | [minecraft-rcon.md](minecraft-rcon.md) |

For Docker-based bring-up of Postgres + slskd + Transmission, see [quick-docker.md](quick-docker.md).
