using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace DrawAI.WebViewEdition {
// Only sanitized response data reaches disk. Request messages, keys and images never do.
sealed class AiLog {
    static readonly Regex Filename = new Regex(@"^ai-\d{8}T\d{9}Z-[a-f0-9]{32}\.json$");
    internal static string DirectoryPath { get { return Path.Combine(Program.Data, "logs", "ai"); } }
    internal readonly Dictionary<string, object> Record = new Dictionary<string, object>();
    internal readonly string Name = "ai-" + DateTime.UtcNow.ToString("yyyyMMddTHHmmssfffZ") + "-" + Guid.NewGuid().ToString("N") + ".json";
    readonly List<string> secrets = new List<string>();
    readonly DateTime started = DateTime.UtcNow;
    internal string WriteError;

    internal AiLog(string id, Uri uri, string key, Dictionary<string, object> body) {
        AddSecret(key);
        foreach (string part in uri.Query.TrimStart('?').Split('&')) {
            string[] pair = part.Split(new[] { '=' }, 2);
            if (pair.Length == 2 && Regex.IsMatch(pair[0], "key|token|secret|auth|password|signature", RegexOptions.IgnoreCase)) AddSecret(Uri.UnescapeDataString(pair[1].Replace("+", " ")));
        }
        int images = 0; var messages = Program.Get(body, "messages") as object[];
        foreach (object message in messages ?? new object[0]) {
            var obj = message as Dictionary<string, object>; if (obj == null) continue;
            var parts = Program.Get(obj, "content") as object[];
            foreach (object part in parts ?? new object[0]) {
                var p = part as Dictionary<string, object>; if (p == null || Program.Str(p, "type") != "image_url") continue;
                images++; var image = Program.Get(p, "image_url") as Dictionary<string, object>;
                string url = image == null ? null : Program.Str(image, "url");
                AddSecret(url);
                if (url != null && url.StartsWith("data:") && url.Contains(",")) AddSecret(url.Substring(url.IndexOf(',') + 1));
            }
        }
        Record["version"] = 1; Record["appVersion"] = typeof(Program).Assembly.GetName().Version.ToString();
        Record["requestId"] = id; Record["startedAtUtc"] = started.ToString("o");
        Record["endpoint"] = Clean(uri.GetLeftPart(UriPartial.Path)); Record["model"] = Clean(Program.Str(body, "model"));
        Record["messageCount"] = messages == null ? 0 : messages.Length; Record["imageCount"] = images;
        Record["stage"] = "request"; Record["outcome"] = "pending";
        Save();
    }
    void AddSecret(string value) {
        if (String.IsNullOrEmpty(value)) return;
        secrets.Add(value);
        secrets.Add(value.Replace("/", "\\/"));
        string escaped = Program.Serialize(value); secrets.Add(escaped.Substring(1, escaped.Length - 2));
        // URI encoding is useful for keys; large image data should not be URI-escaped.
        if (value.Length <= 4096) secrets.Add(Uri.EscapeDataString(value));
    }
    internal string Clean(string value) {
        string text = value ?? "";
        foreach (string secret in secrets.Distinct().OrderByDescending(s => s.Length)) text = text.Replace(secret, "[REDACTED]");
        text = Regex.Replace(text, @"data:image[^,\s""<>]*,[a-zA-Z0-9+/=\\\r\n]+", "[IMAGE REDACTED]", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"Bearer\s+[^\s""<>\\]+", "Bearer [REDACTED]", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"(""(?:api[_-]?key|access[_-]?token|authorization|password|secret)""\s*:\s*"")[^""]*("")", "$1[REDACTED]$2", RegexOptions.IgnoreCase);
        return text;
    }
    internal void Response(int status, string contentType, byte[] bytes, bool truncated) {
        Record["httpStatus"] = status; Record["contentType"] = Clean(contentType);
        Record["responseBytesCaptured"] = bytes.Length; Record["responseTruncated"] = truncated;
        Record["responseBody"] = Clean(Encoding.UTF8.GetString(bytes));
        Record["elapsedMs"] = (long)(DateTime.UtcNow - started).TotalMilliseconds;
        Record["stage"] = "response"; Save();
    }
    internal void Outcome(string outcome, string message, string stage) {
        if (stage == "transport") Record["transportError"] = Clean(message);
        Record["outcome"] = Clean(outcome); Record["error"] = Clean(message); Record["stage"] = stage;
        Record["finishedAtUtc"] = DateTime.UtcNow.ToString("o");
        Record["elapsedMs"] = (long)(DateTime.UtcNow - started).TotalMilliseconds; Save();
    }
    internal void ForgetSecrets() { secrets.Clear(); }
    internal void Save() {
        try {
            Directory.CreateDirectory(DirectoryPath);
            string destination = Path.Combine(DirectoryPath, Name), temporary = destination + ".tmp";
            File.WriteAllText(temporary, Program.Serialize(Record), new UTF8Encoding(false));
            if (File.Exists(destination)) File.Replace(temporary, destination, null); else File.Move(temporary, destination);
            foreach (string old in Files().Skip(20)) File.Delete(Path.Combine(DirectoryPath, old));
            WriteError = null;
        } catch { WriteError = "日志写入失败，请检查程序 data 文件夹的写入权限或磁盘空间。"; }
    }
    internal static string[] Files() {
        if (!Directory.Exists(DirectoryPath)) return new string[0];
        return Directory.GetFiles(DirectoryPath, "ai-*.json").Select(Path.GetFileName).Where(n => Filename.IsMatch(n)).OrderByDescending(n => n).ToArray();
    }
    internal static string Read(string name) {
        if (name == null || !Filename.IsMatch(name)) throw new Exception("日志名称无效。");
        return Program.Read(Path.Combine(DirectoryPath, name));
    }
    internal static object Browse(Dictionary<string, object> request) {
        string action = Program.Str(request, "action"), name = Program.Str(request, "name");
        if (action == "list") return new { files = Files().Take(20).ToArray(), directory = DirectoryPath };
        if (action == "read") return new { text = Read(name) };
        if (action == "copy") { System.Windows.Forms.Clipboard.SetText(Read(name)); return new { }; }
        if (action == "open") { Directory.CreateDirectory(DirectoryPath); System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(DirectoryPath) { UseShellExecute = true }); return new { }; }
        throw new Exception("不支持的日志操作。");
    }
}
}
