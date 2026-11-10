// Small connection surface; credentials are never reflected into status or URLs.
export function mountSyncPanel(connect) {
  const panel = document.createElement('details');
  panel.id = 'listeningSync';
  panel.className = 'sync-panel';
  const summary = document.createElement('summary');
  summary.textContent = '收听记录同步';
  const status = document.createElement('p');
  status.id = 'syncStatus';
  status.setAttribute('role', 'status');
  status.textContent = '尚未连接，收听记录仍保存在本机。';
  const form = document.createElement('form');
  form.className = 'sync-form';
  const originLabel = document.createElement('label');
  originLabel.textContent = '个人同步服务地址';
  const origin = document.createElement('input');
  origin.id = 'syncOrigin';
  origin.type = 'url';
  origin.required = true;
  origin.autocomplete = 'url';
  origin.spellcheck = false;
  originLabel.append(origin);
  const secretLabel = document.createElement('label');
  secretLabel.textContent = '一次性授权码';
  const secret = document.createElement('input');
  secret.id = 'syncActivation';
  secret.type = 'password';
  secret.required = true;
  secret.autocomplete = 'one-time-code';
  secret.spellcheck = false;
  secretLabel.append(secret);
  const button = document.createElement('button');
  button.id = 'syncConnect';
  button.type = 'submit';
  button.textContent = '连接并自动同步';
  const explanation = document.createElement('p');
  explanation.className = 'sync-note';
  explanation.textContent = '首次授权后，进度与偏好自动保存到个人同步服务。Mac 完成首次配对后，会在可运行时每小时备份到 iCloud；服务器已同步不等于 iCloud 已上传。';
  form.append(originLabel, secretLabel, button);
  panel.append(summary, status, form, explanation);
  document.querySelector('.app-header').after(panel);
  function setStatus(message, short = '查看状态') {
    status.textContent = message;
    summary.textContent = `收听记录同步 · ${short}`;
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    button.disabled = true;
    setStatus('正在连接个人同步服务…');
    const activation = secret.value.trim();
    secret.value = '';
    try {
      await connect(origin.value.trim(), activation);
      form.hidden = true;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setStatus('连接未完成，请检查服务地址、授权码或网络。已有收听记录已保留。');
    } finally { button.disabled = false; }
  });
  return {
    setStatus,
    setOrigin(value) { origin.value = value; },
    setConnected(connected) { form.hidden = connected; }
  };
}
