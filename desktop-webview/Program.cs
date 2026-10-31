using System;
using System.Collections;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.VisualBasic.ApplicationServices;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

[assembly: System.Reflection.AssemblyVersion("0.7.3.0")]
[assembly: System.Reflection.AssemblyFileVersion("0.7.3.0")]

namespace DrawAI.WebViewEdition {
static class Program {
    internal const string Origin = "https://drawai.local/";
    internal const int Limit = 12 * 1024 * 1024;
    internal static string Root = AppDomain.CurrentDomain.BaseDirectory;
    internal static string Data = Environment.GetEnvironmentVariable("DRAWAI_WV_DATA_DIR") ?? Path.Combine(Root, "data");
    internal static bool Testing = Environment.GetEnvironmentVariable("DRAWAI_WV_TEST") == "1";
    internal static Task<CoreWebView2Environment> EnvironmentTask;
    internal static JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = Limit * 2, RecursionLimit = 100 };
    internal static List<EditorWindow> Windows = new List<EditorWindow>();
    internal static string LastError;
    internal static string Theme = "#ec7fa4";
    internal static readonly string[,] Themes = { { "经典粉", "#ec7fa4" }, { "天空蓝", "#7fa9ec" }, { "薄荷绿", "#7fc5a4" }, { "柔和紫", "#b397df" }, { "暖杏橙", "#e8ad7d" } };
    internal static void SetTheme(string color) {
        if (!Regex.IsMatch(color ?? "", "^#[0-9a-fA-F]{6}$")) return;
        try { File.WriteAllText(Path.Combine(Data, "theme.txt"), color, new UTF8Encoding(false)); }
        catch (Exception error) { Report("主题偏好无法保存：" + error.Message); return; }
        Theme = color;
        foreach (var window in Windows) { window.UpdateThemeMenu(); window.Send("theme", color); }
    }
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [STAThread] static void Main(string[] args) {
        try {
            SetProcessDPIAware(); Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
            Directory.CreateDirectory(Data); Directory.CreateDirectory(Path.Combine(Data, "temp"));
            try { string saved = File.ReadAllText(Path.Combine(Data, "theme.txt")).Trim(); if (Regex.IsMatch(saved, "^#[0-9a-fA-F]{6}$")) Theme = saved; } catch { }
            Environment.SetEnvironmentVariable("TEMP", Path.Combine(Data, "temp")); Environment.SetEnvironmentVariable("TMP", Path.Combine(Data, "temp"));
            // Check availability; do not silently download/install a large runtime.
            CoreWebView2Environment.GetAvailableBrowserVersionString();
            new SingleInstanceApp().Run(args);
        } catch (WebView2RuntimeNotFoundException) {
            MessageBox.Show("这台电脑尚未安装 Microsoft Edge WebView2 Runtime。\n请安装微软的 Evergreen Runtime 后重新打开。\nhttps://developer.microsoft.com/microsoft-edge/webview2/", "DrawAI · 缺少运行时", MessageBoxButtons.OK, MessageBoxIcon.Information);
        } catch (Exception error) { MessageBox.Show(error.Message, "DrawAI 无法启动", MessageBoxButtons.OK, MessageBoxIcon.Error); }
    }
    internal static Task<CoreWebView2Environment> GetEnvironment() {
        if (EnvironmentTask == null) {
            var options = new CoreWebView2EnvironmentOptions();
            int port;
            if (Testing && Int32.TryParse(Environment.GetEnvironmentVariable("DRAWAI_WV_DEBUG_PORT"), out port) && port >= 1024 && port <= 65535)
                options.AdditionalBrowserArguments = "--remote-debugging-port=" + port + " --remote-debugging-address=127.0.0.1";
            EnvironmentTask = CoreWebView2Environment.CreateAsync(null, Data, options);
        }
        return EnvironmentTask;
    }
    internal static Dictionary<string, object> Obj(object value) {
        var result = value as Dictionary<string, object>; if (result == null) throw new Exception("文件或消息格式无效。"); return result;
    }
    internal static object Get(Dictionary<string, object> obj, string key) { object value; return obj.TryGetValue(key, out value) ? value : null; }
    internal static string Str(Dictionary<string, object> obj, string key) { return Get(obj, key) as string; }
    internal static string Serialize(object value) { return Json.Serialize(value); }
    internal static Dictionary<string, object> Parse(string text) { return Obj(Json.DeserializeObject(text.TrimStart('\uFEFF'))); }
    internal static string Read(string filename) { if (new FileInfo(filename).Length > Limit) throw new Exception("文件超过 12 MB。"); return File.ReadAllText(filename, Encoding.UTF8); }
    internal static string OptionalRead(string filename) { return File.Exists(filename) ? Read(filename) : null; }
    internal static string Key(Dictionary<string, object> payload) { return Serialize(new object[] { Get(payload, "workspaceName"), Get(payload, "document") }); }
    internal static void BasicValidate(Dictionary<string, object> payload) {
        if (Str(payload, "format") != "drawai" || Convert.ToString(Get(payload, "version")) != "1" || !(Get(payload, "document") is Dictionary<string, object>)) throw new Exception("这不是支持的 DrawAI 图表文件。");
        string name = Str(payload, "workspaceName"); if (String.IsNullOrWhiteSpace(name) || name.Length > 60) throw new Exception("图表名称无效。");
        if (Encoding.UTF8.GetByteCount(Serialize(payload)) > Limit) throw new Exception("图表文件超过 12 MB。");
    }
    internal static Tuple<EditorWindow,string> Owner(string filename) {
        string full = Path.GetFullPath(filename);
        foreach (var window in Windows) foreach (var entry in window.Entries)
            if (String.Equals(entry.Value.Path, full, StringComparison.OrdinalIgnoreCase)) return Tuple.Create(window, entry.Key);
        return null;
    }
    internal static EditorWindow CreateWindow(string filename) {
        try {
            string text = null; Dictionary<string, object> payload = null;
            if (filename != null) {
                filename = Path.GetFullPath(filename); var owner = Owner(filename);
                if (owner != null) { owner.Item1.WindowState = FormWindowState.Normal; owner.Item1.Show(); owner.Item1.Activate(); owner.Item1.Send("workspace", owner.Item2); return null; }
                text = Read(filename); payload = Parse(text); BasicValidate(payload);
            }
            return new EditorWindow(filename, text, payload);
        } catch (Exception error) { Report(error.Message); return null; }
    }
    internal static void Open(string filename) { var window = CreateWindow(filename); if (window != null) window.Show(); }
    internal static void Report(string message) { LastError = message; if (!Testing) MessageBox.Show(message, "DrawAI", MessageBoxButtons.OK, MessageBoxIcon.Information); }
}

sealed class SingleInstanceApp : WindowsFormsApplicationBase {
    public SingleInstanceApp() { IsSingleInstance = true; EnableVisualStyles = true; ShutdownStyle = ShutdownMode.AfterAllFormsClose; }
    protected override void OnCreateMainForm() {
        var files = CommandLineArgs.Where(s => s.EndsWith(".drawai", StringComparison.OrdinalIgnoreCase)).ToArray();
        MainForm = Program.CreateWindow(files.FirstOrDefault()) ?? Program.CreateWindow(null);
        MainForm.Shown += (s,e) => { foreach (var file in files.Skip(1)) Program.Open(file); };
    }
    protected override void OnStartupNextInstance(StartupNextInstanceEventArgs e) {
        var files = e.CommandLine.Where(s => s.EndsWith(".drawai", StringComparison.OrdinalIgnoreCase)).ToArray();
        foreach (var file in files) Program.Open(file);
        e.BringToForeground = files.Length == 0;
        base.OnStartupNextInstance(e);
    }
}

sealed class Entry {
    internal Dictionary<string, object> Payload;
    internal string Path, Expected, SavedKey;
    internal bool Dirty { get { return Program.Key(Payload) != SavedKey; } }
}

sealed class EditorWindow : Form {
    internal Dictionary<string, Entry> Entries = new Dictionary<string, Entry>();
    readonly WebView2 view = new WebView2();
    readonly SemaphoreSlim operation = new SemaphoreSlim(1, 1);
    readonly Queue<string> savePaths = new Queue<string>();
    readonly Queue<string> openPaths = new Queue<string>();
    readonly Queue<string> answers = new Queue<string>();
    readonly ToolStripMenuItem themeMenu = new ToolStripMenuItem("主题");
    readonly Dictionary<string, byte[]> assets = new Dictionary<string, byte[]>();
    readonly Dictionary<string, CancellationTokenSource> aiJobs = new Dictionary<string, CancellationTokenSource>();
    readonly Dictionary<string, AiLog> aiLogs = new Dictionary<string, AiLog>();
    readonly string storageKey = "drawai.webview2." + Guid.NewGuid().ToString("N");
    Dictionary<string, object> loaded;
    bool initialized, allowClose, closePending;
    string activeId = "default";
    internal EditorWindow(string filename, string text, Dictionary<string, object> payload) {
        loaded = payload;
        if (payload != null) Entries["default"] = new Entry { Payload = payload, Path = filename, Expected = text, SavedKey = Program.Key(payload) };
        Text = "DrawAI · WebView2 试验版"; ClientSize = new Size(1434, 885); MinimumSize = new Size(820, 620);
        Icon = new Icon(Path.Combine(Program.Root, "icon.ico")); StartPosition = FormStartPosition.CenterScreen;
        view.Dock = DockStyle.Fill; Controls.Add(view);
        var menu = new MenuStrip(); var fileMenu = new ToolStripMenuItem("文件"); menu.Items.Add(fileMenu);
        AddMenu(fileMenu, "新建窗口", Keys.Control | Keys.N, () => Program.Open(null));
        AddMenu(fileMenu, "打开图表…", Keys.Control | Keys.O, () => Send("open"));
        AddMenu(fileMenu, "保存", Keys.Control | Keys.S, () => Send("save"));
        AddMenu(fileMenu, "另存为…", Keys.Control | Keys.Shift | Keys.S, () => Send("save-as"));
        fileMenu.DropDownItems.Add(new ToolStripSeparator()); AddMenu(fileMenu, "关联 .drawai 文件…", Keys.None, Associate);
        AddMenu(fileMenu, "关闭窗口", Keys.Control | Keys.W, () => Close());
        menu.Items.Add(themeMenu);
        for (int i = 0; i < Program.Themes.GetLength(0); i++) {
            string color = Program.Themes[i, 1]; var item = new ToolStripMenuItem(Program.Themes[i, 0]); item.Tag = color;
            var swatch = new Bitmap(16, 16); using (var graphics = Graphics.FromImage(swatch)) graphics.Clear(ColorTranslator.FromHtml(color)); item.Image = swatch;
            item.Click += (s,e) => Program.SetTheme(color); themeMenu.DropDownItems.Add(item);
        }
        UpdateThemeMenu();
        Controls.Add(menu); MainMenuStrip = menu;
        Program.Windows.Add(this); FormClosed += (s,e) => { foreach (var job in aiJobs.Values) job.Cancel(); Program.Windows.Remove(this); view.Dispose(); };
        FormClosing += (s,e) => { if (!allowClose && initialized) { e.Cancel = true; if (!closePending) { closePending = true; Send("close"); } } };
        Shown += async (s,e) => { try { await Start(); } catch (Exception error) { Program.Report(error.Message); allowClose = true; Close(); } };
    }
    void AddMenu(ToolStripMenuItem menu, string label, Keys shortcut, Action action) {
        var item = new ToolStripMenuItem(label); if (shortcut != Keys.None) item.ShortcutKeys = shortcut;
        item.Click += (s,e) => action(); menu.DropDownItems.Add(item);
    }
    internal void UpdateThemeMenu() { foreach (ToolStripMenuItem item in themeMenu.DropDownItems) item.Checked = String.Equals(item.Tag as string, Program.Theme, StringComparison.OrdinalIgnoreCase); }
    internal void Send(string type, string id = null) { if (view.CoreWebView2 != null) view.CoreWebView2.PostWebMessageAsJson(Program.Serialize(new { command = new { type, id } })); }
    async Task Start() {
        foreach (var relative in new[] { "index.html", "src/app.js", "src/model.js", "src/scene.js", "src/ai.js", "src/ai-panel.js", "src/styles.css", "src/portable.json", "native/loader.js" })
            assets["/" + relative] = File.ReadAllBytes(Path.Combine(Program.Root, "web", relative.Replace('/', Path.DirectorySeparatorChar)));
        assets["/"] = assets["/index.html"];
        var environment = await Program.GetEnvironment(); await view.EnsureCoreWebView2Async(environment);
        var core = view.CoreWebView2;
        core.Settings.AreHostObjectsAllowed = false; core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false; core.Settings.AreDevToolsEnabled = Program.Testing;
        core.Settings.IsStatusBarEnabled = false; core.Settings.IsZoomControlEnabled = false;
        core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += (s,e) => {
            Uri uri; byte[] content; bool allowed = Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out uri) && uri.GetLeftPart(UriPartial.Authority) == Program.Origin.TrimEnd('/') && assets.TryGetValue(uri.AbsolutePath, out content);
            if (!allowed) { e.Response = environment.CreateWebResourceResponse(new MemoryStream(), 404, "Not found", "Content-Type: text/plain"); return; }
            content = assets[uri.AbsolutePath];
            string mime = uri.AbsolutePath.EndsWith(".js") ? "text/javascript" : uri.AbsolutePath.EndsWith(".css") ? "text/css" : uri.AbsolutePath.EndsWith(".json") ? "application/json" : "text/html";
            e.Response = environment.CreateWebResourceResponse(new MemoryStream(content, false), 200, "OK", "Content-Type: " + mime + "; charset=utf-8\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'");
        };
        core.NavigationStarting += (s,e) => { if (e.Uri != Program.Origin || initialized) e.Cancel = true; };
        core.NewWindowRequested += (s,e) => e.Handled = true;
        core.PermissionRequested += (s,e) => e.State = CoreWebView2PermissionState.Deny;
        core.WebMessageReceived += Receive;
        core.DownloadStarting += Download;
        core.ProcessFailed += (s,e) => Program.Report("显示进程异常，请关闭窗口并重新打开已保存图表。" + e.ProcessFailedKind);
        await core.AddScriptToExecuteOnDocumentCreatedAsync("if(location.href===" + Program.Serialize(Program.Origin) + "){window.__DRAWAI_WV_BOOTSTRAP__=" + Program.Serialize(new { storageKey, payload = loaded, testing = Program.Testing, theme = Program.Theme }) + ";}");
        core.Navigate(Program.Origin);
    }
    async Task<Dictionary<string, object>> Validate(object value) {
        var payload = Program.Obj(value); Program.BasicValidate(payload);
        // Canonical model validation runs in the trusted local page, not in user data.
        string code = "(()=>{try{return {value:window.__drawaiValidate(" + Program.Serialize(payload) + ")}}catch(e){return {error:e.message}}})()";
        var result = Program.Parse(await view.CoreWebView2.ExecuteScriptAsync(code));
        if (Program.Get(result, "error") != null) throw new Exception(Program.Str(result, "error"));
        return Program.Obj(Program.Get(result, "value"));
    }
    object Status() { return new { entries = Entries.Select(p => new { id = p.Key, path = p.Value.Path, dirty = p.Value.Dirty }).ToArray() }; }
    void UpdateTitle() { Entry entry; if (Entries.TryGetValue(activeId, out entry)) Text = (entry.Dirty ? "● " : "") + (entry.Path == null ? Program.Str(entry.Payload, "workspaceName") : Path.GetFileName(entry.Path)) + " — DrawAI WebView2"; }
    async Task Changed(object value, bool initial = false) {
        var message = Program.Obj(value); string id = Program.Str(message, "id");
        if (id == null || !Regex.IsMatch(id, @"^[\w-]{1,80}$")) throw new Exception("无效的工作空间。");
        var payload = await Validate(Program.Get(message, "payload"));
        Entry entry;
        if (!Entries.TryGetValue(id, out entry)) {
            if (Entries.Count >= 50) throw new Exception("工作空间过多。");
            entry = new Entry(); Entries[id] = entry;
        }
        entry.Payload = payload;
        if (initial) entry.SavedKey = Program.Key(payload);
        string active = Program.Str(message, "activeId"); activeId = active != null && Entries.ContainsKey(active) ? active : id;
        UpdateTitle();
    }
    async void Receive(object sender, CoreWebView2WebMessageReceivedEventArgs e) {
        if (e.Source != Program.Origin) return;
        object id = null, result;
        try {
            if (e.WebMessageAsJson.Length > Program.Limit * 2) throw new Exception("消息过大。");
            var message = Program.Parse(e.WebMessageAsJson); id = Program.Get(message, "id");
            string type = Program.Str(message, "type"); object value = Program.Get(message, "value");
            if (type == "initialize") {
                if (initialized) throw new Exception("重复初始化。"); var values = value as object[];
                if (values == null || values.Length > 50) throw new Exception("工作空间无效。");
                foreach (var item in values) await Changed(item, true); initialized = true; result = Status();
            } else if (type == "changed" && initialized) { await Changed(value); result = Status(); }
            else if (type == "ai-request" && initialized) result = await RequestAI(Program.Obj(value));
            else if (type == "ai-logs" && initialized) result = AiLog.Browse(Program.Obj(value));
            else if (type == "ai-log-result" && initialized) {
                var update = Program.Obj(value); AiLog log; string requestId = Program.Str(update, "id");
                if (requestId == null || !aiLogs.TryGetValue(requestId, out log)) throw new Exception("未找到对应的 AI 请求日志。");
                string outcome = Program.Str(update, "outcome"), error = Program.Str(update, "error") ?? "";
                if (!new[] { "success", "error", "canceled", "timeout", "pending-review" }.Contains(outcome) || error.Length > 16000) throw new Exception("日志结果格式无效。");
                log.Outcome(outcome, error, "client-result"); log.ForgetSecrets(); aiLogs.Remove(requestId); result = new { file = log.Name, logError = log.WriteError };
            }
            else if (type == "ai-cancel" && initialized) {
                CancellationTokenSource job; string requestId = Program.Str(Program.Obj(value), "id");
                if (requestId != null && aiJobs.TryGetValue(requestId, out job)) job.Cancel(); result = new { };
            }
            else if ((type == "save" || type == "export") && initialized) {
                var request = Program.Obj(value); await operation.WaitAsync();
                try { result = await Save(Program.Str(request, "id"), Object.Equals(Program.Get(request, "saveAs"), true), type == "export"); } finally { operation.Release(); }
            } else if (type == "open" && initialized) { OpenFiles(); result = new { }; }
            else if (type == "close" && initialized) {
                await operation.WaitAsync(); try { result = await CheckClose(); } finally { operation.Release(); closePending = false; }
            } else if (type == "invalid") { Program.Report(Program.Str(Program.Obj(value), "message")); result = new { }; }
            else if (type == "test" && Program.Testing) result = Test(Program.Obj(value));
            else throw new Exception("不支持此操作。");
        } catch (Exception error) { result = new { error = error.Message }; closePending = false; }
        if (!IsDisposed && view.CoreWebView2 != null) view.CoreWebView2.PostWebMessageAsJson(Program.Serialize(new { id, result }));
    }
    async Task<object> RequestAI(Dictionary<string, object> request) {
        string id = Program.Str(request, "id"), endpoint = Program.Str(request, "endpoint"), key = Program.Str(request, "key"), body = Program.Str(request, "body");
        Uri uri;
        if (id == null || !Regex.IsMatch(id, @"^[\w-]{1,80}$") || key == null || key.Length > 4096 || key.IndexOfAny(new[] { '\r', '\n' }) >= 0 || body == null || Encoding.UTF8.GetByteCount(body) > 16 * 1024 * 1024 ||
            !Uri.TryCreate(endpoint, UriKind.Absolute, out uri) || (uri.Scheme != "http" && uri.Scheme != "https") || uri.UserInfo != "" || uri.Fragment != "" || !uri.AbsolutePath.EndsWith("/chat/completions")) throw new Exception("AI 请求格式无效。");
        var parsed = Program.Parse(body); var messages = Program.Get(parsed, "messages") as object[];
        if (String.IsNullOrWhiteSpace(Program.Str(parsed, "model")) || messages == null || messages.Length > 30 || !Object.Equals(Program.Get(parsed, "stream"), false)) throw new Exception("AI 请求格式无效。");
        if (aiJobs.Count != 0) throw new Exception("已有 AI 请求正在进行。");
        // Bound transient response records across repeated calls, including abandoned UI requests.
        foreach (var old in aiLogs.Keys.ToArray()) { aiLogs[old].ForgetSecrets(); aiLogs.Remove(old); }
        var log = new AiLog(id, uri, key, parsed); aiLogs[id] = log;
        var cancellation = new CancellationTokenSource(); aiJobs[id] = cancellation; cancellation.CancelAfter(120000);
        try {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            using (var handler = new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false, AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate })
            using (var client = new HttpClient(handler))
            using (var message = new HttpRequestMessage(HttpMethod.Post, uri)) {
                client.Timeout = TimeSpan.FromSeconds(120);
                message.Content = new StringContent(body, Encoding.UTF8, "application/json");
                if (key != "") message.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", key);
                using (var response = await client.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, cancellation.Token))
                using (var input = await response.Content.ReadAsStreamAsync())
                using (var output = new MemoryStream()) {
                    var buffer = new byte[16384]; int count;
                    while ((count = await input.ReadAsync(buffer, 0, buffer.Length, cancellation.Token)) > 0) {
                        if (output.Length + count > 2 * 1024 * 1024) {
                            log.Response((int)response.StatusCode, Convert.ToString(response.Content.Headers.ContentType), output.ToArray(), true);
                            log.Outcome("error", "AI 返回内容过大，画布未修改。", "transport");
                            return new { error = "AI 返回内容过大，画布未修改。", logFile = log.Name, logError = log.WriteError };
                        }
                        output.Write(buffer, 0, count);
                    }
                    log.Response((int)response.StatusCode, Convert.ToString(response.Content.Headers.ContentType), output.ToArray(), false);
                    return new { text = Encoding.UTF8.GetString(output.ToArray()), status = (int)response.StatusCode, logFile = log.Name, logError = log.WriteError };
                }
            }
        } catch (OperationCanceledException error) { log.Outcome("canceled-or-timeout", error.GetType().Name, "transport"); return new { error = "AI 请求已停止或超时。", logFile = log.Name, logError = log.WriteError }; }
        catch (Exception error) { log.Outcome("error", error.GetType().Name + ": " + error.Message, "transport"); return new { error = "无法连接 API，请检查地址和网络。", logFile = log.Name, logError = log.WriteError }; }
        finally { aiJobs.Remove(id); cancellation.Dispose(); }
    }
    string PickSave(string current, string name, bool copy = false) {
        if (Program.Testing) return savePaths.Count == 0 ? null : savePaths.Dequeue();
        using (var picker = new SaveFileDialog { Title = copy ? "导出 DrawAI 文件" : "保存 DrawAI 图表", FileName = current ?? Regex.Replace(name, "[<>:\"/\\\\|?*\\x00-\\x1f]", "_") + (copy ? "-副本" : "") + ".drawai", Filter = "DrawAI 图表|*.drawai", DefaultExt = "drawai", AddExtension = true, OverwritePrompt = true })
            return picker.ShowDialog(this) == DialogResult.OK ? picker.FileName : null;
    }
    async Task<object> Save(string id, bool saveAs, bool copy = false) {
        Entry entry; if (id == null || !Entries.TryGetValue(id, out entry)) throw new Exception("找不到工作空间。");
        var snapshot = await Validate(entry.Payload); string filename = entry.Path, expected = entry.Expected;
        if (filename == null || saveAs || copy) {
            filename = PickSave(copy ? null : filename, Program.Str(snapshot, "workspaceName"), copy);
            if (String.IsNullOrEmpty(filename)) return new { canceled = true };
            if (!filename.EndsWith(".drawai", StringComparison.OrdinalIgnoreCase)) {
                filename += ".drawai";
                if (File.Exists(filename) && Ask("替换已有图表？\n" + filename) != DialogResult.Yes) return new { canceled = true };
            }
            filename = Path.GetFullPath(filename); var owner = Program.Owner(filename);
            if (owner != null && (copy || owner.Item1 != this || owner.Item2 != id)) throw new Exception("此文件已在工作空间或窗口中打开，请使用其他文件名；更新原文件请使用保存。");
            expected = String.Equals(filename, entry.Path, StringComparison.OrdinalIgnoreCase) ? entry.Expected : Program.OptionalRead(filename);
        }
        string text = Program.Serialize(snapshot) + "\n";
        if (Encoding.UTF8.GetByteCount(text) > Program.Limit) throw new Exception("图表超过 12 MB。");
        CheckExpected(filename, expected);
        string temporary = Path.Combine(Path.GetDirectoryName(filename), "." + Path.GetFileName(filename) + "." + Guid.NewGuid().ToString("N") + ".tmp");
        try {
            using (var file = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
                byte[] bytes = new UTF8Encoding(false).GetBytes(text); file.Write(bytes, 0, bytes.Length); file.Flush(true);
            }
            CheckExpected(filename, expected);
            if (expected == null) File.Move(temporary, filename); else File.Replace(temporary, filename, null);
        } finally { if (File.Exists(temporary)) File.Delete(temporary); }
        if (!copy) { entry.Path = filename; entry.Expected = text; entry.SavedKey = Program.Key(snapshot); }
        UpdateTitle(); return Status();
    }
    void CheckExpected(string filename, string expected) { if (Program.OptionalRead(filename) != expected) throw new Exception("文件已被其他程序修改或移动，未覆盖。请另存为或重新打开原文件。"); }
    DialogResult Ask(string message) {
        if (Program.Testing) return answers.Count == 0 ? DialogResult.Cancel : (DialogResult)Enum.Parse(typeof(DialogResult), answers.Dequeue());
        return MessageBox.Show(this, message, "DrawAI", MessageBoxButtons.YesNoCancel, MessageBoxIcon.Question, MessageBoxDefaultButton.Button1);
    }
    async Task<object> CheckClose() {
        var dirty = Entries.Where(p => p.Value.Dirty).ToArray();
        if (dirty.Length > 0) {
            var answer = Ask("保存修改后关闭？\n" + String.Join("、", dirty.Select(p => Program.Str(p.Value.Payload, "workspaceName"))));
            if (answer == DialogResult.Cancel) return new { canceled = true };
            if (answer == DialogResult.Yes) {
                foreach (var pair in dirty) { var result = Program.Obj(Program.Json.DeserializeObject(Program.Serialize(await Save(pair.Key, false)))); if (Object.Equals(Program.Get(result, "canceled"), true)) return result; }
                if (Entries.Any(p => p.Value.Dirty)) throw new Exception("保存期间有新修改，请再次保存后关闭。");
            }
        }
        allowClose = true; BeginInvoke(new Action(Close)); return new { };
    }
    void OpenFiles() {
        if (Program.Testing) { while (openPaths.Count > 0) Program.Open(openPaths.Dequeue()); return; }
        using (var picker = new OpenFileDialog { Title = "打开 DrawAI 图表", Filter = "DrawAI 图表|*.drawai", Multiselect = true })
            if (picker.ShowDialog(this) == DialogResult.OK) foreach (var file in picker.FileNames) Program.Open(file);
    }
    void Download(object sender, CoreWebView2DownloadStartingEventArgs e) {
        e.Handled = true;
        string filename;
        if (Program.Testing) filename = savePaths.Count == 0 ? null : savePaths.Dequeue();
        else using (var picker = new SaveFileDialog { FileName = Path.GetFileName(e.ResultFilePath), OverwritePrompt = true }) filename = picker.ShowDialog(this) == DialogResult.OK ? picker.FileName : null;
        if (String.IsNullOrEmpty(filename)) e.Cancel = true; else e.ResultFilePath = filename;
    }
    object Test(Dictionary<string, object> request) {
        string action = Program.Str(request, "action"); object value = Program.Get(request, "data");
        if (action == "save-path") savePaths.Enqueue(value as string);
        else if (action == "open-path") openPaths.Enqueue(value as string);
        else if (action == "answer") answers.Enqueue(value as string);
        else if (action == "close") BeginInvoke(new Action(Close));
        else if (action == "error") return new { message = Program.LastError };
        else if (action == "theme") { var item = themeMenu.DropDownItems.Cast<ToolStripMenuItem>().FirstOrDefault(i => i.Text == value as string); if (item == null) throw new Exception("主题不存在"); item.PerformClick(); }
        else if (action == "theme-menu") return themeMenu.DropDownItems.Cast<ToolStripMenuItem>().Select(i => new { label = i.Text, selected = i.Checked }).ToArray();
        else if (action == "info") return new { runtime = view.CoreWebView2.Environment.BrowserVersionString, pid = System.Diagnostics.Process.GetCurrentProcess().Id, browserPid = view.CoreWebView2.BrowserProcessId };
        else if (action == "viewport") { var size = Program.Obj(value); ClientSize = new Size(Convert.ToInt32(Program.Get(size, "width")), Convert.ToInt32(Program.Get(size, "height")) + MainMenuStrip.Height); }
        else if (action == "exit") BeginInvoke(new Action(() => { foreach (var window in Program.Windows.ToArray()) { window.allowClose = true; window.Close(); } }));
        else throw new Exception("无效测试操作。");
        return new { };
    }
    [DllImport("shell32.dll")] static extern void SHChangeNotify(uint e, uint f, IntPtr a, IntPtr b);
    void Associate() {
        if (Program.Testing) return;
        if (MessageBox.Show(this, "用此 WebView2 试验版打开 .drawai 文件？\n仅关联当前用户。程序文件夹移动后需重新关联。", "DrawAI", MessageBoxButtons.OKCancel) != DialogResult.OK) return;
        try {
            using (var prog = Registry.CurrentUser.CreateSubKey(@"Software\Classes\DrawAI.WebView2.Diagram")) {
                prog.SetValue("", "DrawAI 图表"); using (var icon = prog.CreateSubKey("DefaultIcon")) icon.SetValue("", "\"" + Application.ExecutablePath + "\",0");
                using (var command = prog.CreateSubKey(@"shell\open\command")) command.SetValue("", "\"" + Application.ExecutablePath + "\" \"%1\"");
            }
            using (var extension = Registry.CurrentUser.CreateSubKey(@"Software\Classes\.drawai")) {
                extension.SetValue("", "DrawAI.WebView2.Diagram"); using (var choices = extension.CreateSubKey("OpenWithProgids")) choices.SetValue("DrawAI.WebView2.Diagram", new byte[0], RegistryValueKind.None);
            }
            SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero);
            Program.Report("文件类型已登记。如 Windows 询问打开方式，请选择此处的 DrawAI-WebView2.exe，并勾选始终使用。");
        } catch (Exception error) { Program.Report(error.Message); }
    }
}
}
