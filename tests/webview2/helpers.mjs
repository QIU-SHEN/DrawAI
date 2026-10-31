import { chromium } from '@playwright/test';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function launchWebView(filename, existingDirectory) {
  const base = path.resolve('.local/webview2-tests'); await mkdir(base, { recursive: true });
  const directory = existingDirectory || await mkdtemp(path.join(base, 'run-'));
  const socket = net.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const executable = path.resolve('releases/DrawAI-WebView2-0.7.3-win-x64/DrawAI-WebView2.exe');
  const env = { ...process.env, DRAWAI_WV_TEST: '1', DRAWAI_WV_DATA_DIR: path.join(directory, 'profile'), DRAWAI_WV_DEBUG_PORT: String(port), TEMP: directory, TMP: directory };
  const child = spawn(executable, filename ? [filename] : [], { env, windowsHide: true, stdio: 'ignore' });
  let browser;
  try {
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error('WebView2 host exited: ' + child.exitCode);
      try { const response = await fetch(`http://127.0.0.1:${port}/json/version`); if (response.ok) break; } catch {}
      await pause(200);
    }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    // Keep downloads owned by the native host, rather than Playwright's CDP override.
    const session = await browser.newBrowserCDPSession(); await session.send('Browser.setDownloadBehavior', { behavior: 'default' }); await session.detach();
    for (let i = 0; i < 100; i++) {
      const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('https://drawai.local/'));
      if (page) {
        // Keep this owned test window from taking keyboard input from the user's work.
        await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -Namespace DrawAITest -Name Window -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool ShowWindowAsync(System.IntPtr hWnd, int nCmdShow);'; $testProcess = Get-Process -Id ${child.pid}; [DrawAITest.Window]::ShowWindowAsync($testProcess.MainWindowHandle, 0) | Out-Null`], { windowsHide: true });
        return { browser, page, child, env, directory, executable,
        second: file => promisify(execFile)(executable, [file], { env, windowsHide: true, timeout: 20000 }),
        stop: async () => {
          try { const active = browser.contexts().flatMap(c => c.pages()).find(p => !p.isClosed()); await active?.evaluate(() => window.__drawaiTest?.('exit')); } catch {}
          await browser.close().catch(() => {});
          if (child.exitCode === null) { await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(3000)]); if (child.exitCode === null) child.kill(); }
        },
        };
      }
      await pause(100);
    }
    throw new Error('Editor did not navigate');
  } catch (error) { await browser?.close().catch(() => {}); child.kill(); throw error; }
}
export const native = (page, action, data) => page.evaluate(({ action, data }) => window.__drawaiTest(action, data), { action, data });
export async function processMemory(pid) {
  const script = `$all = @(Get-CimInstance Win32_Process); $ids = @(${Number(pid)}); do { $next = @($all | Where-Object { $_.ParentProcessId -in $ids -and $_.ProcessId -notin $ids } | ForEach-Object { [int]$_.ProcessId }); $ids += $next } while ($next.Count -gt 0); @($ids | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue } | Select-Object Id,ProcessName,WorkingSet64,PrivateMemorySize64) | ConvertTo-Json -Compress`;
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
  const processes = JSON.parse(stdout);
  return { processes, workingSetMiB: processes.reduce((s,p) => s+p.WorkingSet64,0)/1048576, privateMiB: processes.reduce((s,p) => s+p.PrivateMemorySize64,0)/1048576 };
}
