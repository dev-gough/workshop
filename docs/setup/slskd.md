# slskd (Soulseek)

[slskd](https://github.com/slskd/slskd) is a self-hosted Soulseek client with an HTTP API. The workshop talks to it for searches, transfers, and download staging.

## Install

```bash
mkdir -p ~/slskd && cd ~/slskd
docker run -d --name slskd \
  -p 5030:5030 -p 5031:5031 -p 50300:50300 \
  -v $(pwd):/app slskd/slskd:latest
```

(Native install: see slskd's own README.)

## Configure

1. Browse to <http://localhost:5030>, set an admin password.
2. Generate an API key in `Settings → System → API Keys`.
3. Set the **Downloads** directory to `<your music dir>/.slskd-downloads`.
4. Enable **Soulseek credentials** under `Settings → Network`.

## Wire it up

In the workshop, open <http://localhost:3000/setup>, paste the slskd base URL (`http://localhost:5030`) and the API key, then click **Test connection**. Toggle **Auto-ingest** to have completed downloads auto-flow into your music library.

## Background daemon

The `soulseek-ingest` systemd service polls slskd every 10 s and stages completed transfers. Install it via `bash scripts/install-systemd.sh`.
