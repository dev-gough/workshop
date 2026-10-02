using System;
using Assets.Scripts.Actors.Player;
using BepInEx;
using BepInEx.Unity.IL2CPP;
using Il2CppInterop.Runtime.Injection;
using UnityEngine;

namespace MegabonkBridge;

[BepInPlugin(Plugin.Id, Plugin.Name, Plugin.Version)]
public sealed class Plugin : BasePlugin
{
    public const string Id = "devys.megabonk.bridge";
    public const string Name = "Megabonk Bridge";
    public const string Version = "0.2.0";

    internal static BridgeServer Server;

    public override void Load()
    {
        var port = Config.Bind("Bridge", "Port", 47315, "WebSocket port on 127.0.0.1. The workshop page connects here.").Value;
        Server = new BridgeServer(port, Log);
        Server.Start();
        RunSample.Listen(Log);
        LeaderboardBlock.Apply(Log);
        ClassInjector.RegisterTypeInIl2Cpp<BridgeTicker>();
        AddComponent<BridgeTicker>();
        Log.LogInfo($"Megabonk bridge listening on ws://127.0.0.1:{port}");
    }

    internal static string Sample()
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        try
        {
            var player = MyPlayer.Instance;
            if (player == null)
            {
                RunSample.ResetRun();
                return Idle(now);
            }
            return RunSample.Build(player, now);
        }
        catch (Exception ex)
        {
            Server.LogFailure(ex);
            return Idle(now);
        }
    }

    static string Idle(long now) => "{\"v\":2,\"t\":" + now + ",\"inRun\":false}";
}

public sealed class BridgeTicker : MonoBehaviour
{
    float wait;

    public BridgeTicker(IntPtr pointer) : base(pointer) { }

    void Update()
    {
        LeaderboardBlock.KeepOff();
        wait += Time.unscaledDeltaTime;
        if (wait < 0.2f) return;
        wait = 0f;
        Plugin.Server.Publish(Plugin.Sample());
    }
}
