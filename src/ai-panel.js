import { aiSettings, aiRequest, aiResponse, fetchAI } from './ai.js';

export function mountAIPanel(host) {
  const $ = id => document.getElementById(id), panel = $('ai-panel'), sessions = new Map();
  let key = '', busy = null, reading = 0;
  try { const saved = JSON.parse(localStorage.getItem('drawai.ai.settings.v1')); if (saved) { $('ai-address').value = String(saved.address || ''); $('ai-model').value = String(saved.model || ''); } } catch {}
  const state = () => { const id = host.context().id; if (!sessions.has(id)) sessions.set(id, { messages: [], images: [], draft: '', pending: null }); return sessions.get(id); };
  const settings = () => ({ address: $('ai-address').value, model: $('ai-model').value, key });
  const note = message => { $('ai-status').textContent = message; };
  let lastLogFile = null;
  const logDialog = $('ai-log-dialog');
  $('ai-view-logs').hidden = !host.logs;
  async function logCall(action, name) {
    const reply = await host.logs.browse(action, name);
    if (reply.error) throw new Error(reply.error);
    return reply;
  }
  async function readLog() {
    const name = $('ai-log-files').value;
    $('ai-log-copy').disabled = !name;
    if (!name) { $('ai-log-content').value = '暂无日志。发送一次 AI 请求后会自动记录。'; return; }
    try {
      const reply = await logCall('read', name);
      try {
        const entry = JSON.parse(reply.text), raw = entry.responseBody; delete entry.responseBody;
        let content = '';
        try { const body = JSON.parse(raw); content = body.choices?.[0]?.message?.content; if (typeof content !== 'string') content = JSON.stringify(content || ''); } catch {}
        $('ai-log-content').value = (content ? '—— 模型内容 message.content ——\n' + content + '\n\n' : '') + '—— 请求与解析结果 ——\n' + JSON.stringify(entry, null, 2) + (raw !== undefined ? '\n\n—— 原始 HTTP 回复（已脱敏） ——\n' + raw : '');
      } catch { $('ai-log-content').value = reply.text; }
    } catch (error) { $('ai-log-content').value = error.message; }
  }
  $('ai-view-logs').onclick = async () => {
    logDialog.showModal(); $('ai-log-content').value = '正在读取日志…';
    try {
      const reply = await logCall('list'); $('ai-log-path').textContent = reply.directory;
      $('ai-log-files').replaceChildren(...reply.files.map(name => { const option = document.createElement('option'); option.value = name; option.textContent = name; return option; }));
      if (reply.files.includes(lastLogFile)) $('ai-log-files').value = lastLogFile;
      await readLog();
    } catch (error) { $('ai-log-content').value = error.message; }
  };
  $('ai-log-files').onchange = readLog;
  $('ai-log-close').onclick = () => logDialog.close();
  $('ai-log-copy').onclick = async () => { try { await logCall('copy', $('ai-log-files').value); $('ai-log-status').textContent = '日志已复制。'; } catch (error) { $('ai-log-status').textContent = error.message; } };
  $('ai-log-folder').onclick = async () => { try { await logCall('open'); } catch (error) { $('ai-log-status').textContent = error.message; } };
  function remember() {
    key = $('ai-key').value.trim(); aiSettings(settings());
    try { localStorage.setItem('drawai.ai.settings.v1', JSON.stringify({ address: $('ai-address').value.trim(), model: $('ai-model').value.trim() })); } catch {}
  }
  function messageElement(item) {
    const box = document.createElement('div'); box.className = 'ai-message ' + item.role;
    const label = document.createElement('strong'); label.textContent = item.role === 'user' ? '你' : 'DrawAI'; box.append(label);
    const content = document.createElement('p'); content.textContent = item.text; box.append(content);
    if (item.images?.length) { const info = document.createElement('small'); info.textContent = '附图 ' + item.images.length + ' 张'; box.append(info); }
    if (item.status) { const info = document.createElement('small'); info.textContent = item.status; box.append(info); }
    return box;
  }
  function refresh() {
    const s = state(), messages = $('ai-messages');
    messages.replaceChildren(...s.messages.map(messageElement));
    $('ai-empty').hidden = !!s.messages.length;
    $('ai-prompt').value = s.draft;
    $('ai-images').replaceChildren(...s.images.map((img, i) => {
      const box = document.createElement('div'), preview = document.createElement('img'), remove = document.createElement('button');
      preview.src = img.url; preview.alt = img.name; remove.type = 'button'; remove.textContent = '×'; remove.title = '移除图片'; remove.setAttribute('aria-label', '移除 ' + img.name);
      remove.onclick = () => { s.images.splice(i, 1); refresh(); }; box.append(preview, remove); return box;
    }));
    $('ai-send').disabled = !!busy || !!reading;
    $('ai-test').disabled = !!busy;
    $('ai-stop').hidden = !busy;
    $('ai-new-workspace').hidden = !s.pending;
    $('ai-clear').disabled = !!busy;
    $('ai-toggle').textContent = busy ? 'AI 生成中…' : '✧ AI 做图';
    if (busy) note(busy.testing ? '正在测试连接…' : busy.workspace === host.context().id ? 'AI 正在理解并绘图，可以随时停止…' : '另一个工作空间正在生成，可以停止或稍后返回查看。');
    messages.scrollTop = messages.scrollHeight;
  }
  $('ai-toggle').onclick = () => { panel.hidden = !panel.hidden; $('ai-toggle').setAttribute('aria-expanded', String(!panel.hidden)); if (!panel.hidden) { refresh(); $('ai-prompt').focus(); } host.resize(); };
  $('ai-close').onclick = () => { panel.hidden = true; $('ai-toggle').setAttribute('aria-expanded', 'false'); host.resize(); };
  $('ai-prompt').oninput = event => { state().draft = event.target.value; };
  $('ai-config-save').onclick = () => { try { remember(); $('ai-config').open = false; note('接口设置已保存；API Key 仅本次打开有效。'); } catch (error) { note(error.message); } };
  $('ai-key').oninput = event => { key = event.target.value; };
  $('ai-clear').onclick = () => { const s = state(); s.messages = []; s.pending = null; refresh(); note('已清空本工作空间的对话，图表保持不变。'); };
  $('ai-undo').onclick = () => host.undo();
  $('ai-new-workspace').onclick = () => { const s = state(); if (s.pending && host.openWorkspace(s.pending)) { s.pending = null; refresh(); note('生成结果已在新工作空间打开。'); } };
  $('ai-stop').onclick = () => { if (busy) { busy.canceled = true; busy.controller.abort(); host.transport?.cancel(busy.id); note('已停止请求，画布未修改。'); } };
  $('ai-form').onsubmit = event => { event.preventDefault(); send(false); };
  $('ai-test').onclick = () => send(true);
  $('ai-prompt').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send(false); } };
  $('ai-attach').onclick = () => $('ai-image-file').click();
  $('ai-image-file').onchange = event => { attach([...event.target.files]); event.target.value = ''; };
  $('ai-form').addEventListener('paste', event => { const files = [...(event.clipboardData?.files || [])]; if (files.length) { event.preventDefault(); attach(files); } });
  $('ai-form').addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
  $('ai-form').addEventListener('drop', event => { if (event.dataTransfer.files.length) { event.preventDefault(); attach([...event.dataTransfer.files]); } });
  async function attach(files) {
    const s = state(); reading++; refresh();
    try {
      for (const file of files) {
        if (s.images.length >= 3) throw new Error('每次最多附 3 张图片。');
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('支持 PNG、JPEG、WebP 图片。');
        if (file.size > 4 * 1024 * 1024 || s.images.reduce((n, i) => n + i.size, file.size) > 8 * 1024 * 1024) throw new Error('单张图片最多 4 MB，每次图片合计最多 8 MB。');
        const url = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('图片读取失败。')); r.readAsDataURL(file); });
        await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => img.width * img.height <= 24000000 ? resolve() : reject(new Error('图片像素过大，请缩小后再添加。')); img.onerror = () => reject(new Error('无法识别这张图片。')); img.src = url; });
        s.images.push({ url, name: file.name, size: file.size });
      }
      note('附图准备好了。图片仅随本次消息发送，请使用支持识图的模型。');
    } catch (error) { note(error.message); }
    finally { reading--; refresh(); }
  }
  async function send(testing) {
    if (busy || reading) return;
    const s = state(), text = s.draft.trim() || (s.images.length ? '请把图片中的结构还原成可编辑图表。' : '');
    if (!testing && !text) { $('ai-prompt').focus(); return; }
    let request, base;
    try {
      remember(); base = host.snapshot();
      request = testing ? { ...aiSettings(settings()), body: JSON.stringify({ model: settings().model.trim(), stream: false, messages: [{ role: 'user', content: '只回复 OK' }] }) } : aiRequest(settings(), base, s.messages, text, s.images);
    } catch (error) { $('ai-config').open = true; note(error.message); return; }
    const job = { id: crypto.randomUUID(), workspace: base.id, controller: new AbortController(), canceled: false, testing };
    busy = job;
    if (!testing) {
      s.messages.push({ role: 'user', text, images: s.images.map(i => ({ name: i.name })) }); s.images = []; s.draft = '';
      if (s.messages.length > 40) s.messages.splice(0, s.messages.length - 40);
    }
    refresh();
    let outcome = 'success', diagnostic = '', logError = '';
    const timer = setTimeout(() => { job.timedOut = true; job.controller.abort(); host.transport?.cancel(job.id); }, 120000);
    try {
      const reply = host.transport ? await host.transport.request({ ...request, id: job.id }) : await fetchAI(request, job.controller.signal);
      lastLogFile = reply.logFile || null; logError = reply.logError || '';
      if (job.canceled || job.timedOut) return;
      if (reply.error) throw new Error(reply.error);
      if (testing) {
        if (reply.status < 200 || reply.status >= 300) aiResponse(reply.text, reply.status);
        let body; try { body = JSON.parse(reply.text); } catch { throw new Error('接口未返回 JSON，请检查地址。'); }
        if (!body.choices?.[0]?.message) throw new Error('接口回复不符合 Chat Completions 格式。');
        note('连接成功，模型可用。识图能力需通过附图请求确认。'); return;
      }
      const result = aiResponse(reply.text, reply.status);
      let status = '';
      if (result.document) {
        if (host.apply(result.document, base)) { status = '已应用到画布 · 可撤销'; s.pending = null; }
        else { s.pending = result.document; outcome = 'pending-review'; status = '画布已变化，未覆盖。可在新工作空间查看结果。'; }
      }
      s.messages.push({ role: 'assistant', text: result.message || '已生成图表。', status });
      note(status || 'AI 已回复。');
      if (host.context().id !== base.id) host.notify('AI 已完成，请回到原工作空间查看结果。');
    } catch (error) {
      if (job.canceled || job.timedOut) return;
      outcome = 'error';
      diagnostic = [error.name + ': ' + error.message, error.cause ? error.cause.name + ': ' + error.cause.message : '', error.stack || ''].filter(Boolean).join('\n');
      const message = error instanceof TypeError ? (host.transport ? '无法连接 API，请检查地址和网络。' : '无法连接 API，请检查地址、网络和跨域设置；不支持浏览器跨域的接口可使用桌面版。') : error.message;
      const safe = [key, request.key].filter(Boolean).reduce((text, secret) => text.split(secret).join('[已隐藏]'), String(message));
      const displayed = safe + (host.logs ? '\n请求编号：' + job.id + '。点击「查看日志」查看原始回复。' : '');
      if (!testing) s.messages.push({ role: 'assistant', text: displayed });
      note(displayed);
    } finally {
      clearTimeout(timer);
      if (host.logs) {
        try {
          const saved = await host.logs.result({ id: job.id, outcome: job.timedOut ? 'timeout' : job.canceled ? 'canceled' : outcome, error: diagnostic.slice(0, 16000) });
          lastLogFile = saved.file || lastLogFile; logError = saved.error || saved.logError || '';
        } catch { logError = '日志写入失败。'; }
      }
      busy = null; refresh();
      if (job.timedOut) note('请求超过 120 秒，已停止，画布未修改。可缩小绘图范围后重试。');
      else if (job.canceled) note('已停止请求，画布未修改。');
      if (logError) note($('ai-status').textContent + '\n' + logError);
    }
  }
  return { refresh };
}
