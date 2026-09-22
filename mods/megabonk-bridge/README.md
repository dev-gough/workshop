# Megabonk bridge

Read-only BepInEx plugin. Five times a second it reads the player stat block and sends a snapshot to the workshop page on `ws://127.0.0.1:47315`.

While this plugin is loaded it forces **Upload Score to Leaderboards** off and skips `QueueLeaderboardUpload` and `UploadLeaderboardScore`, so a run cannot be submitted. That lasts for the session; quit the game before playing a run you want on the board.

## Build on Windows

1. Install [BepInExPack IL2CPP](https://thunderstore.io/c/megabonk/p/BepInEx/BepInExPack_IL2CPP/) into the game folder and start Megabonk once, so `BepInEx/interop` exists.
2. Install the [.NET 6 SDK](https://dotnet.microsoft.com/download/dotnet/6.0).
3. Copy this `mods/megabonk-bridge` folder to the PC (or clone the repo).
4. From that folder:

```powershell
dotnet build -c Release -p:GameDir="C:\Program Files (x86)\Steam\steamapps\common\Megabonk"
```

If Steam installed the game somewhere else, point `GameDir` at the folder that contains `Megabonk.exe`.

5. Copy `bin\Release\MegabonkBridge.dll` to `Megabonk\BepInEx\plugins\`.
6. Start the game. The BepInEx console should say `Megabonk bridge listening on ws://127.0.0.1:47315`.

## Page

The workshop connects to that socket from the browser. An https page is not allowed to open `ws://127.0.0.1`, so open the workshop over http on this PC (the local dev server is fine). "Game linked" means the socket is up. "Follow the game" copies crit, attack speed, elite damage, and poison onto the sliders. The big "In-game damage" figure is `DamageMultiplier` straight from the run.

A game update can rename a stat accessor. If the build fails on `PlayerStats.GetStat` or `MyPlayer.Instance`, the interop assembly in `BepInEx/interop/Assembly-CSharp.dll` is the source of the new names.
