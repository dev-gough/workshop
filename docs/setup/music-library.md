# Music library

Powers `/projects/barfoo` (player + analytics) and `/projects/soulseek` (download staging area).

## Layout

The workshop expects an artist/album/track tree:

```
<musicDirectory>/
  Artist Name/
    Album Title/
      01 Track.flac
      02 Track.flac
      cover.jpg
  ...
  .slskd-downloads/         # auto-created when slskd ingest is enabled
```

## Wire it up

In `/setup` → **Paths → Music directory**, point at your library root. Click **Test connection** to verify the path exists.

## Initial scan

After connecting, populate the database:

```bash
npm run scan-music
```

This walks every artist/album, pulls metadata via `music-metadata`, and writes to `albums` / `songs` tables.

## Supported formats

`.mp3 .flac .wav .m4a .ogg` — anything `music-metadata` can parse.
