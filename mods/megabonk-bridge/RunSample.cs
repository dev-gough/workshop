using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using Assets.Scripts.Actors;
using Assets.Scripts.Actors.Enemies;
using Assets.Scripts.Actors.Player;
using Assets.Scripts.Inventory__Items__Pickups.Items;
using Assets.Scripts.Inventory__Items__Pickups.Stats;
using Assets.Scripts.Menu.Shop;
using Assets.Scripts._Data.Tomes;
using BepInEx.Logging;
using HarmonyLib;
using UnityEngine;

namespace MegabonkBridge;

/// <summary>
/// One snapshot of the local run: every non-zero stat, the inventories,
/// and damage dealt over the last few seconds grouped by damage source.
/// </summary>
static class RunSample
{
    const float WindowSeconds = 10f;

    struct Hit
    {
        public float T;
        public string Source;
        public float Amount;
    }

    static readonly List<Hit> Hits = new List<Hit>(256);
    static readonly Dictionary<string, float> Lifetime = new Dictionary<string, float>();
    static readonly Dictionary<string, string> IconUrls = new Dictionary<string, string>();
    static readonly Dictionary<string, string> SourceIcons = new Dictionary<string, string>();
    static readonly Queue<IconJob> IconQueue = new Queue<IconJob>();
    static readonly HashSet<string> IconQueued = new HashSet<string>();
    static bool listening;

    sealed class IconJob
    {
        public string Id;
        public Texture Tex;
        public string Source;
    }

    public static void ResetRun()
    {
        Hits.Clear();
        Lifetime.Clear();
    }

    public static void Listen(ManualLogSource log)
    {
        if (listening) return;
        try
        {
            // Weapon hits, item procs, and external hits all funnel through this private method.
            var method = AccessTools.Method(typeof(Enemy), "Damage", new[] { typeof(DamageContainer) });
            if (method == null)
            {
                log.LogWarning("Enemy.Damage was not found. DPS will stay empty.");
                return;
            }
            new Harmony(Plugin.Id + ".damage").Patch(method, postfix: new HarmonyMethod(typeof(RunSample), nameof(OnHit)));
            listening = true;
            log.LogInfo("Counting damage dealt by source.");
        }
        catch (Exception ex)
        {
            log.LogWarning("Damage events are not hooked, so DPS will stay empty: " + ex.Message);
        }
    }

    // The argument name has to be damageContainer. Harmony binds postfix
    // parameters by the target method's parameter name, and this one is not "dc".
    static void OnHit(DamageContainer damageContainer)
    {
        try
        {
            if (damageContainer == null || damageContainer.damage <= 0f) return;
            var source = damageContainer.damageSource;
            if (string.IsNullOrEmpty(source)) source = "Unlabeled";
            Hits.Add(new Hit { T = Time.unscaledTime, Source = source, Amount = damageContainer.damage });
            float soFar;
            Lifetime.TryGetValue(source, out soFar);
            Lifetime[source] = soFar + damageContainer.damage;
        }
        catch (Exception)
        {
            // A bad container must not break the hit that raised the event.
        }
    }

    public static string Build(MyPlayer player, long nowMs)
    {
        PumpIcon();
        var sb = new StringBuilder(1024);
        sb.Append("{\"v\":2,\"t\":").Append(nowMs).Append(",\"inRun\":true");
        AppendVitals(sb, player);
        AppendStats(sb, player);
        AppendItems(sb, player);
        AppendWeapons(sb, player);
        AppendTomes(sb, player);
        AppendDealt(sb);
        sb.Append('}');
        return sb.ToString();
    }

    static void AppendVitals(StringBuilder sb, MyPlayer player)
    {
        var inventory = player.inventory;
        if (inventory == null) return;
        try
        {
            var health = inventory.playerHealth;
            if (health != null)
            {
                sb.Append(",\"hp\":").Append(health.hp);
                sb.Append(",\"maxHp\":").Append(health.maxHp);
                sb.Append(",\"shield\":").Append(Num(health.shield));
            }
        }
        catch (Exception) { }
        try
        {
            sb.Append(",\"gold\":").Append(Num(inventory.gold));
        }
        catch (Exception) { }
        try
        {
            var xp = inventory.playerXp;
            if (xp != null) sb.Append(",\"level\":").Append(xp.level);
        }
        catch (Exception) { }
    }

    static void AppendStats(StringBuilder sb, MyPlayer player)
    {
        // The six names the page already reads, plus every other non-zero stat.
        sb.Append(",\"stats\":{");
        sb.Append("\"damageMultiplier\":").Append(Num(Stat(player, EStat.DamageMultiplier)));
        sb.Append(",\"critChance\":").Append(Num(Stat(player, EStat.CritChance)));
        sb.Append(",\"critDamage\":").Append(Num(Stat(player, EStat.CritDamage)));
        sb.Append(",\"attackSpeed\":").Append(Num(Stat(player, EStat.AttackSpeed)));
        sb.Append(",\"eliteDamage\":").Append(Num(Stat(player, EStat.EliteDamageMultiplier)));
        sb.Append(",\"poisonDamage\":").Append(Num(Stat(player, EStat.PoisonDamageMultiplier)));
        sb.Append('}');

        sb.Append(",\"all\":[");
        var first = true;
        foreach (EStat stat in Enum.GetValues(typeof(EStat)))
        {
            var name = stat.ToString();
            if (name == "Unused0") continue;
            float value;
            try { value = Stat(player, stat); }
            catch (Exception) { continue; }
            if (Math.Abs(value) < 0.00005f) continue;
            if (!first) sb.Append(',');
            first = false;
            sb.Append("{\"id\":\"").Append(Js(name)).Append("\",\"v\":").Append(Num(value)).Append('}');
        }
        sb.Append(']');
    }

    static void AppendItems(StringBuilder sb, MyPlayer player)
    {
        sb.Append(",\"items\":[");
        var first = true;
        try
        {
            var items = player.inventory != null && player.inventory.itemInventory != null
                ? player.inventory.itemInventory.items
                : null;
            if (items != null)
            {
                var enumerator = items.GetEnumerator();
                while (enumerator.MoveNext())
                {
                    var current = enumerator.Current;
                    var item = current.Value;
                    if (item == null || item.amount <= 0) continue;
                    if (!first) sb.Append(',');
                    first = false;
                    var id = current.Key.ToString();
                    var icon = RememberIcon(id, ItemTexture(current.Key), item.damageSource);
                    sb.Append("{\"id\":\"").Append(Js(id)).Append('"');
                    sb.Append(",\"n\":").Append(item.amount);
                    var power = PowerBonus(item);
                    if (Math.Abs(power) > 0.00005f) sb.Append(",\"power\":").Append(Num(power));
                    AppendIcon(sb, icon);
                    sb.Append('}');
                }
            }
        }
        catch (Exception) { }
        sb.Append(']');
    }

    static float PowerBonus(ItemBase item)
    {
        if (item.statModifiers == null) return 0f;
        float sum = 0f;
        var mods = item.statModifiers.GetEnumerator();
        while (mods.MoveNext())
        {
            var pair = mods.Current;
            if (!pair.Key.Equals(EStat.DamageMultiplier) || pair.Value == null || pair.Value.statContainers == null)
                continue;
            var containers = pair.Value.statContainers.GetEnumerator();
            while (containers.MoveNext())
            {
                var modifier = containers.Current.Value;
                if (modifier != null) sum += modifier.modification;
            }
        }
        return sum;
    }

    static void AppendWeapons(StringBuilder sb, MyPlayer player)
    {
        sb.Append(",\"weapons\":[");
        var first = true;
        try
        {
            var weapons = player.inventory != null && player.inventory.weaponInventory != null
                ? player.inventory.weaponInventory.weapons
                : null;
            if (weapons != null)
            {
                var enumerator = weapons.GetEnumerator();
                while (enumerator.MoveNext())
                {
                    var current = enumerator.Current;
                    var weapon = current.Value;
                    if (weapon == null) continue;
                    var name = current.Key.ToString();
                    try
                    {
                        if (weapon.weaponData != null && !string.IsNullOrEmpty(weapon.weaponData.damageSourceName))
                            name = weapon.weaponData.damageSourceName;
                    }
                    catch (Exception) { }
                    float damage = 0f;
                    try { damage = weapon.GetValue(EStat.DamageMultiplier); }
                    catch (Exception) { }
                    if (!first) sb.Append(',');
                    first = false;
                    var icon = RememberIcon(name, WeaponTexture(current.Key), name);
                    sb.Append("{\"id\":\"").Append(Js(name)).Append('"');
                    sb.Append(",\"level\":").Append(weapon.level);
                    sb.Append(",\"damage\":").Append(Num(damage));
                    sb.Append(",\"on\":").Append(weapon.enabled ? "true" : "false");
                    AppendIcon(sb, icon);
                    sb.Append('}');
                }
            }
        }
        catch (Exception) { }
        sb.Append(']');
    }

    static void AppendTomes(StringBuilder sb, MyPlayer player)
    {
        sb.Append(",\"tomes\":[");
        var first = true;
        try
        {
            var tomes = player.inventory != null ? player.inventory.tomeInventory : null;
            var levels = tomes != null ? tomes.tomeLevels : null;
            if (levels != null)
            {
                var enumerator = levels.GetEnumerator();
                while (enumerator.MoveNext())
                {
                    var current = enumerator.Current;
                    if (current.Value <= 0) continue;
                    if (!first) sb.Append(',');
                    first = false;
                    var id = current.Key.ToString();
                    var icon = RememberIcon(id, TomeTexture(current.Key), null);
                    sb.Append("{\"id\":\"").Append(Js(id)).Append('"');
                    sb.Append(",\"level\":").Append(current.Value);
                    AppendIcon(sb, icon);
                    sb.Append('}');
                }
            }
        }
        catch (Exception) { }
        sb.Append(']');
    }

    static void AppendDealt(StringBuilder sb)
    {
        var now = Time.unscaledTime;
        var cutoff = now - WindowSeconds;
        var totals = new Dictionary<string, float>();
        float sum = 0f;
        for (var i = Hits.Count - 1; i >= 0; i--)
        {
            if (Hits[i].T < cutoff)
            {
                Hits.RemoveRange(0, i + 1);
                break;
            }
            float soFar;
            totals.TryGetValue(Hits[i].Source, out soFar);
            totals[Hits[i].Source] = soFar + Hits[i].Amount;
            sum += Hits[i].Amount;
        }

        sb.Append(",\"dps\":").Append(Num(sum / WindowSeconds));
        sb.Append(",\"dealt\":[");
        WriteSources(sb, totals);
        sb.Append("],\"run\":[");
        WriteSources(sb, Lifetime);
        sb.Append(']');
    }

    static void WriteSources(StringBuilder sb, Dictionary<string, float> totals)
    {
        var first = true;
        foreach (var pair in totals)
        {
            if (pair.Value <= 0f) continue;
            if (!first) sb.Append(',');
            first = false;
            sb.Append("{\"source\":\"").Append(Js(pair.Key)).Append("\",\"damage\":").Append(Num(pair.Value));
            string icon;
            if (SourceIcons.TryGetValue(pair.Key, out icon)) sb.Append(",\"icon\":\"").Append(icon).Append('"');
            sb.Append('}');
        }
    }

    static void AppendIcon(StringBuilder sb, string icon)
    {
        if (icon != null) sb.Append(",\"icon\":\"").Append(icon).Append('"');
    }

    static string RememberIcon(string id, Texture texture, string source)
    {
        if (string.IsNullOrEmpty(id) || texture == null) return null;
        string url;
        if (!IconUrls.TryGetValue(id, out url))
        {
            if (IconQueued.Add(id)) IconQueue.Enqueue(new IconJob { Id = id, Tex = texture, Source = source });
            return null;
        }
        if (!string.IsNullOrEmpty(source)) SourceIcons[source] = url;
        return url;
    }

    static void PumpIcon()
    {
        // Grabbing every icon during the level load is what crashed the game.
        // Wait until the level is up, then copy one texture per snapshot.
        if (IconQueue.Count == 0 || Time.timeSinceLevelLoad < 2.5f) return;
        var job = IconQueue.Dequeue();
        if (job.Tex == null) return;
        var url = EncodeIcon(job.Tex);
        if (url == null) return;
        IconUrls[job.Id] = url;
        if (!string.IsNullOrEmpty(job.Source)) SourceIcons[job.Source] = url;
    }

    static Texture ItemTexture(EItem key)
    {
        try
        {
            var data = DataManager.Instance;
            if (data == null) return null;
            var item = data.GetItem(key);
            return item != null ? item.GetIcon() : null;
        }
        catch (Exception) { return null; }
    }

    static Texture WeaponTexture(EWeapon key)
    {
        try
        {
            var data = DataManager.Instance;
            if (data == null) return null;
            var weapon = data.GetWeapon(key);
            return weapon != null ? weapon.GetIcon() : null;
        }
        catch (Exception) { return null; }
    }

    static Texture TomeTexture(ETome key)
    {
        try
        {
            var data = DataManager.Instance;
            if (data == null) return null;
            var tome = data.GetTome(key);
            return tome != null ? tome.GetIcon() : null;
        }
        catch (Exception) { return null; }
    }

    static string EncodeIcon(Texture texture)
    {
        var width = texture.width;
        var height = texture.height;
        if (width < 1 || height < 1 || width > 1024 || height > 1024) return null;
        var readable = texture as Texture2D;
        if (readable != null && readable.isReadable)
        {
            var direct = ToPng(readable);
            if (direct != null && direct.Length > 0) return "data:image/png;base64," + Convert.ToBase64String(direct);
        }

        Texture2D copy = null;
        RenderTexture rt = null;
        var previous = RenderTexture.active;
        try
        {
            var side = Math.Min(32, Math.Max(width, height));
            rt = RenderTexture.GetTemporary(side, side, 0, RenderTextureFormat.ARGB32);
            Graphics.Blit(texture, rt);
            RenderTexture.active = rt;
            copy = new Texture2D(side, side, TextureFormat.RGBA32, false);
            copy.ReadPixels(new Rect(0f, 0f, side, side), 0, 0);
            copy.Apply();
            var png = ToPng(copy);
            if (png == null || png.Length == 0) return null;
            return "data:image/png;base64," + Convert.ToBase64String(png);
        }
        catch (Exception)
        {
            return null;
        }
        finally
        {
            RenderTexture.active = previous;
            if (rt != null) RenderTexture.ReleaseTemporary(rt);
            if (copy != null) UnityEngine.Object.Destroy(copy);
        }
    }

    static byte[] ToPng(Texture2D copy)
    {
        var direct = copy.GetType().GetMethod("EncodeToPNG", Type.EmptyTypes);
        return direct != null ? direct.Invoke(copy, null) as byte[] : null;
    }

    static float Stat(MyPlayer player, EStat stat)
    {
        var inventory = player.inventory;
        if (inventory == null || inventory.playerStats == null) return 0f;
        return inventory.playerStats.GetStat(stat);
    }

    static string Num(float value) => value.ToString("0.####", CultureInfo.InvariantCulture);

    static string Js(string value)
    {
        if (string.IsNullOrEmpty(value)) return "";
        return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
    }
}
