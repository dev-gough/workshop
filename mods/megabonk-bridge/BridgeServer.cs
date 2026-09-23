using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using BepInEx.Logging;

namespace MegabonkBridge;

/// <summary>
/// Tiny WebSocket server on 127.0.0.1. TcpListener avoids the URL reservation
/// HttpListener needs on Windows. Speaks just enough of RFC 6455 for one
/// browser client: text frames out, ping/close in.
/// </summary>
public sealed class BridgeServer
{
    const string WebsocketGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

    readonly int port;
    readonly ManualLogSource log;
    readonly object gate = new();
    readonly List<TcpClient> clients = new();
    TcpListener listener;
    volatile string latest = "{\"v\":1,\"t\":0,\"inRun\":false}";
    int failures;

    public BridgeServer(int port, ManualLogSource log)
    {
        this.port = port;
        this.log = log;
    }

    public void Start()
    {
        listener = new TcpListener(IPAddress.Loopback, port);
        listener.Start();
        var accept = new Thread(AcceptLoop) { IsBackground = true, Name = "MegabonkBridgeAccept" };
        var send = new Thread(SendLoop) { IsBackground = true, Name = "MegabonkBridgeSend" };
        accept.Start();
        send.Start();
    }

    public void Publish(string json) => latest = json;

    public void LogFailure(Exception ex)
    {
        if (Interlocked.Increment(ref failures) > 3) return;
        log.LogWarning($"Stat read failed: {ex.Message}");
    }

    void AcceptLoop()
    {
        while (true)
        {
            TcpClient client;
            try
            {
                client = listener.AcceptTcpClient();
            }
            catch (Exception ex)
            {
                log.LogWarning($"Bridge accept stopped: {ex.Message}");
                return;
            }
            var accepted = client;
            var handshake = new Thread(() => Handshake(accepted));
            handshake.IsBackground = true;
            handshake.Start();
        }
    }

    void Handshake(TcpClient client)
    {
        client.NoDelay = true;
        var stream = client.GetStream();
        stream.ReadTimeout = 4000;
        var buffer = new byte[2048];
        var request = new StringBuilder();
        try
        {
            while (request.ToString().IndexOf("\r\n\r\n", StringComparison.Ordinal) < 0)
            {
                var read = stream.Read(buffer, 0, buffer.Length);
                if (read <= 0) { client.Close(); return; }
                request.Append(Encoding.ASCII.GetString(buffer, 0, read));
                if (request.Length > 8192) { client.Close(); return; }
            }
            var key = Header(request.ToString(), "Sec-WebSocket-Key");
            if (string.IsNullOrEmpty(key)) { client.Close(); return; }
            var accept = Convert.ToBase64String(SHA1.HashData(Encoding.ASCII.GetBytes(key + WebsocketGuid)));
            var response = "HTTP/1.1 101 Switching Protocols\r\n"
                + "Upgrade: websocket\r\n"
                + "Connection: Upgrade\r\n"
                + "Sec-WebSocket-Accept: " + accept + "\r\n\r\n";
            var bytes = Encoding.ASCII.GetBytes(response);
            stream.Write(bytes, 0, bytes.Length);
        }
        catch (Exception ex)
        {
            log.LogWarning($"Bridge handshake failed: {ex.Message}");
            client.Close();
            return;
        }

        stream.ReadTimeout = Timeout.Infinite;
        lock (gate) clients.Add(client);
        log.LogInfo("Workshop page connected");
        var reading = client;
        var reader = new Thread(() => ReadLoop(reading));
        reader.IsBackground = true;
        reader.Start();
    }

    void SendLoop()
    {
        while (true)
        {
            Thread.Sleep(200);
            byte[] payload;
            try { payload = Encoding.UTF8.GetBytes(latest); }
            catch { continue; }
            TcpClient[] copy;
            lock (gate) copy = clients.ToArray();
            foreach (var client in copy)
            {
                try
                {
                    WriteFrame(client.GetStream(), 0x1, payload);
                }
                catch
                {
                    Drop(client);
                }
            }
        }
    }

    void ReadLoop(TcpClient client)
    {
        var stream = client.GetStream();
        var head = new byte[2];
        try
        {
            while (ReadExact(stream, head, 2))
            {
                var opcode = head[0] & 0x0F;
                var masked = (head[1] & 0x80) != 0;
                var length = (int)(head[1] & 0x7F);
                if (length == 126)
                {
                    var ext = new byte[2];
                    if (!ReadExact(stream, ext, 2)) break;
                    length = (ext[0] << 8) | ext[1];
                }
                else if (length == 127)
                {
                    break;
                }
                var mask = new byte[4];
                if (masked && !ReadExact(stream, mask, 4)) break;
                var data = new byte[length];
                if (length > 0 && !ReadExact(stream, data, length)) break;
                if (masked)
                {
                    for (var i = 0; i < data.Length; i++) data[i] ^= mask[i % 4];
                }
                if (opcode == 0x8) break;
                if (opcode == 0x9) WriteFrame(stream, 0xA, data);
            }
        }
        catch
        {
            // The page closed the tab, or the frame was short. Drop and wait.
        }
        Drop(client);
    }

    void Drop(TcpClient client)
    {
        lock (gate) clients.Remove(client);
        try { client.Close(); } catch { /* already gone */ }
    }

    static void WriteFrame(NetworkStream stream, int opcode, byte[] payload)
    {
        var header = new byte[4];
        var count = 0;
        header[count++] = (byte)(0x80 | opcode);
        if (payload.Length < 126)
        {
            header[count++] = (byte)payload.Length;
        }
        else
        {
            header[count++] = 126;
            header[count++] = (byte)(payload.Length >> 8);
            header[count++] = (byte)payload.Length;
        }
        stream.Write(header, 0, count);
        if (payload.Length > 0) stream.Write(payload, 0, payload.Length);
    }

    static bool ReadExact(NetworkStream stream, byte[] buffer, int count)
    {
        var filled = 0;
        while (filled < count)
        {
            var read = stream.Read(buffer, filled, count - filled);
            if (read <= 0) return false;
            filled += read;
        }
        return true;
    }

    static string Header(string request, string name)
    {
        foreach (var line in request.Split(new[] { "\r\n" }, StringSplitOptions.None))
        {
            var split = line.IndexOf(':');
            if (split <= 0) continue;
            if (line.Substring(0, split).Trim().Equals(name, StringComparison.OrdinalIgnoreCase))
                return line.Substring(split + 1).Trim();
        }
        return null;
    }
}
