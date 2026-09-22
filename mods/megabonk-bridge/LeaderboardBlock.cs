using System;
using Assets.Scripts.Managers;
using BepInEx.Logging;
using HarmonyLib;

namespace MegabonkBridge;

/// <summary>
/// While this plugin is loaded, score uploads cannot leave the machine.
/// The game's own upload methods are skipped, and the settings flag is held
/// at off so a run cannot be queued in the first place.
/// </summary>
static class LeaderboardBlock
{
    public static void Apply(ManualLogSource log)
    {
        try
        {
            var type = AccessTools.TypeByName("SteamLeaderboardsManagerNew");
            if (type == null)
            {
                log.LogWarning("SteamLeaderboardsManagerNew was not found. Leaderboard uploads were not blocked.");
                return;
            }

            var harmony = new Harmony(Plugin.Id);
            Patch(harmony, type, "QueueLeaderboardUpload", log);
            Patch(harmony, type, "UploadLeaderboardScore", log);
            KeepOff();
            log.LogInfo("Leaderboard uploads are disabled while the bridge is loaded.");
        }
        catch (Exception ex)
        {
            log.LogWarning($"Leaderboard block failed: {ex.Message}");
        }
    }

    public static void KeepOff()
    {
        try
        {
            var settings = SaveManager.Instance?.config?.cfGameSettings;
            if (settings != null && settings.upload_score_to_leaderboard != 0)
                settings.upload_score_to_leaderboard = 0;
        }
        catch
        {
            // Save data is not ready during the first frames. The upload patch still holds.
        }
    }

    static void Patch(Harmony harmony, Type type, string name, ManualLogSource log)
    {
        var method = AccessTools.Method(type, name);
        if (method == null)
        {
            log.LogWarning($"Leaderboard method {name} was not found.");
            return;
        }
        harmony.Patch(method, prefix: new HarmonyMethod(typeof(LeaderboardBlock), nameof(Reject)));
    }

    static bool Reject() => false;
}
