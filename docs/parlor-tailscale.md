# Handoff: labserver Parlor → home laptop over Tailscale

Give this to the agent working in the toolbox repo. The laptop is already on the tailnet. The toolbox app is not, until the share below is done.

## What talks to what

The laptop (RTX 3060 Laptop, 6GB, 16GB RAM) is the only machine that runs models. The toolbox keeps its own Postgres, users, and chats. Do not point it at the home workshop database.

Two channels, both over Tailscale, nothing on the public internet:

1. **Chat** is HTTP to Ollama. `GET /api/tags`, `POST /api/chat` with `stream: true` (NDJSON). No API key. Ollama on the laptop listens on `0.0.0.0:11434`.
2. **Drawing** is not Ollama. SSH to the laptop, prompt on stdin, and run `/home/devon/compute/parlor-image.sh <output-png> <drawer>`. Drawers are `qwen-image-2.1` and `z-image-turbo`. The script stops Ollama first so the 6GB GPU is free, draws, and writes the PNG. The toolbox then `cat`s that path and deletes it, the same way `src/lib/laptop-image.ts` does in devys-workshop.

Verified from the home server: `http://devy-l.taild8840b.ts.net:11434/api/tags` returns 200. The IP is `100.106.46.68`. Use the name, not the LAN address `192.168.2.51`. That address only works at home.

## Names, and the step a human still has to click

| Machine | Tailscale name | Tailscale IP | Tailnet |
|---|---|---|---|
| Laptop | `devy-l.taild8840b.ts.net` | `100.106.46.68` | devgough, `taild8840b.ts.net` |
| Home workshop | `server.taild8840b.ts.net` | `100.77.237.64` | same |
| Lab server | `labserver.tail575440.ts.net` | `100.72.224.121` | ThomasKulin, `tail575440.ts.net` |

Labserver shows up on the home tailnet as a shared node from a different tailnet. It cannot see `devy-l` until somebody shares that machine. In the Tailscale admin console for `taild8840b.ts.net`, share `devy-l` with the lab tailnet (the one that owns `labserver`). Until that share exists, every connection from labserver to the laptop will time out, and no code change will fix it.

Ollama has no password. After the share, any device on the lab tailnet that can see `devy-l` can call port 11434. Prefer an ACL that allows `11434` and SSH only from `labserver` and `server`.

## Toolbox config

Copy the parlor from devys-workshop, then set:

```json
"ollama": {
  "baseUrl": "http://devy-l.taild8840b.ts.net:11434",
  "sshHost": "devon@devy-l.taild8840b.ts.net"
}
```

`sshHost` defaults to `devy-l`, which is the home LAN alias. On labserver that default is wrong. Leave it explicit.

Files to bring over:

- `src/app/projects/parlor/`
- `src/app/api/parlor/`
- `src/lib/parlor.ts`, `parlor-auth.ts`, `parlor-db.ts`, `parlor-models.ts`, `ollama.ts`, `laptop-image.ts`
- `scripts/migrations/031-parlor.sql`
- the `.parlor-theme` / `.parlor-room` / `.parlor-md` block in `src/app/globals.css`

Restyle the page to the toolbox. It currently uses the workshop header hook (`useHeaderConfig`), the shared `Button`, and the `ws-serif` class. Point those at toolbox equivalents. Apply the migration to the toolbox database. Image files land in `data/parlor/` on the app server, not on the laptop.

## SSH

Labserver needs a key that logs in as `devon` on the laptop with `BatchMode` and no password prompt. The draw path is not Tailscale SSH. It is normal SSH over the tailnet address.

```bash
ssh -o BatchMode=yes -o ConnectTimeout=8 devon@devy-l.taild8840b.ts.net 'test -x /home/devon/compute/parlor-image.sh'
```

From a checkout of devys-workshop, the same check plus the model list is:

```bash
scripts/parlor-tailscale-check.sh \
  http://devy-l.taild8840b.ts.net:11434 \
  devon@devy-l.taild8840b.ts.net
```

## Models the picker should show

Chat (Ollama tags). Hide any tag starting with `hf.co/`.

| Tag | Label | Notes |
|---|---|---|
| `laptop-qwen35` | Qwen3.5 4B | 3.4GB, context capped at 32768 |
| `laptop-coder-3b` | Coder 3B | 1.9GB, context 32768 |
| `laptop-gemma4` | Gemma 4 E2B | 4.3GB, context capped at 16384 |
| `laptop-qwen3` | Qwen3 8B | already there |
| `laptop-coder` | Coder 7B | already there |
| `laptop-coder-30b` | Coder 30B | spills into the 16GB of RAM |
| `gpt-oss:20b` | gpt-oss 20B | same, spills into RAM |

Gemma and Qwen3.5 report a `vision` capability. That means they can accept images. It does not mean they draw. Keep them on the Talk side. The parlor UI only sends text.

Draw (not in Ollama; the app adds these names itself):

| Drawer id | Label |
|---|---|
| `qwen-image-2.1` | Qwen Image 2.1 |
| `z-image-turbo` | Z-Image Turbo |

Only one draw at a time. A second one gets "The laptop is already drawing."
