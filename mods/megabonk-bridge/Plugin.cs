using System;
using System.Globalization;
using Assets.Scripts.Actors.Player;
using Assets.Scripts.Inventory__Items__Pickups.Stats;
using Assets.Scripts.Menu.Shop;
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
    public const string Version = "0.1.0";

    internal static BridgeServer Server = null!;

    public override void Load()
    {
        var port = Config.Bind("Bridge", "Port", 47315, "WebSocket port on 127.0.0.1. The workshop page connects here.").Value;
        Server = new BridgeServer(port, Log);
        Server.Start();
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
                return Idle(now);

            // Raw stat units, matching PlayerStats.GetStat:
            // fractions for crit chance and attack speed, multipliers for the rest.
            // Crit damage is the raw stat; the workshop shows it as raw × 2.
            var damage = Stat(EStat.DamageMultiplier);
            var critChance = Stat(EStat.CritChance);
            var critDamage = Stat(EStat.CritDamage);
            var attackSpeed = Stat(EStat.AttackSpeed);
            var elite = Stat(EStat.EliteDamageMultiplier);
            var poison = Stat(EStat.PoisonDamageMultiplier);
            return "{\"v\":1,\"t\":" + now + ",\"inRun\":true,\"stats\":{"
                + "\"damageMultiplier\":" + Num(damage) + ","
                + "\"critChance\":" + Num(critChance) + ","
                + "\"critDamage\":" + Num(critDamage) + ","
                + "\"attackSpeed\":" + Num(attackSpeed) + ","
                + "\"eliteDamage\":" + Num(elite) + ","
                + "\"poisonDamage\":" + Num(poison)
                + "}}";
        }
        catch (Exception ex)
        {
            Server.LogFailure(ex);
            return Idle(now);
        }
    }

    static float Stat(EStat stat)
    {
        return PlayerStats.GetStat(stat);
    }

    static string Idle(long now) => "{\"v\":1,\"t\":" + now + ",\"inRun\":false}";

    static string Num(float value) => value.ToString("0.####", CultureInfo.InvariantCulture);
}

public sealed class BridgeTicker : MonoBehaviour
{
    float wait;

    public BridgeTicker(IntPtr pointer) : base(pointer) { }

    void Update()
    {
        wait += Time.unscaledDeltaTime;
        if (wait < 0.2f) return;
        wait = 0f;
        Plugin.Server.Publish(Plugin.Sample());
    }
}
