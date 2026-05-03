# Minecraft RCON

The server dashboard can run console commands against Minecraft servers via the RCON protocol.

## Per-server setup

In each Minecraft server's `server.properties`:

```properties
enable-rcon=true
rcon.port=25586
rcon.password=your-strong-password
```

Restart the Minecraft server.

## Wire it up

Edit `config.json` directly (no GUI editor for this array yet):

```json
{
  "minecraftServers": [
    { "name": "minecraft-atm10", "host": "127.0.0.1", "port": 25586, "password": "your-strong-password" }
  ]
}
```

The `name` field must match the systemd service unit (e.g. `minecraft-atm10.service`) so the dashboard ties RCON to the right tile.

## Verify

The server dashboard's RCON drawer ships a `list` command — clicking it should return your online players list.
