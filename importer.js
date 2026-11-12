let importPlan = [];
let importController = null;
let importTopic = null;
function privateCatalog(value) {
  if (!Array.isArray(value) || !value.length) throw new Error('私人目录必须包含音轨');
  const ids = new Set();
  const names = new Set();
  return value.map(item => {
    if (!item || typeof item.id !== 'string' || !/^private-[a-z0-9-]+$/.test(item.id) || ids.has(item.id) ||
        !['title', 'date', 'fileName'].every(key => typeof item[key] === 'string' && item[key].length > 0) ||
        !Number.isFinite(item.duration) || item.duration <= 0 || !Number.isSafeInteger(item.bytes) || item.bytes <= 0 ||
        !/^[a-f0-9]{64}$/.test(item.sha256) || !['audio/mp4', 'audio/mpeg', 'audio/ogg'].includes(item.mime)) {
      throw new Error('私人目录格式无效');
    }
    if (names.has(item.fileName) || item.fileName !== item.fileName.trim() ||
        /[/\\:\u0000-\u001f\u007f]/.test(item.fileName) || ['.', '..'].includes(item.fileName)) {
      throw new Error('私人目录文件名必须唯一且为可选择的本地文件名');
    }
    ids.add(item.id);
    names.add(item.fileName);
    return { id: item.id, title: item.title, date: item.date, fileName: item.fileName,
      duration: item.duration, bytes: item.bytes, sha256: item.sha256, mime: item.mime,
      speaker: '', chapters: [], privateAudio: true, localOnly: true, audioSrc: '' };
  });
}
function readPrivateCatalog() {
  const raw = localStorage.getItem('mw_private_catalog');
  if (raw === null) return [];
  const value = JSON.parse(raw);
  if (Array.isArray(value) && !value.length) return [];
  return privateCatalog(value);
}
function privateCatalogStatus(text) {
  let message = document.getElementById('privateCatalogStatus');
  if (!message) {
    message = document.createElement('p');
    message.id = 'privateCatalogStatus';
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');
    document.getElementById('importSection').before(message);
  }
  message.textContent = text;
}
function resetImportSelection() {
  importPlan = [];
  importTopic = null;
  byId('importPreview').textContent = '可一次选择整个文件夹，也可以分批选择音频文件。';
  byId('btnStartImport').hidden = true;
}
function showImportSelection(files) {
  if (importController) return;
  importTopic = typeof topic !== 'undefined' ? topic : null;
  const availableTracks = (typeof allTracks !== 'undefined' && Array.isArray(allTracks))
    ? allTracks
    : (importTopic?.tracks || []);
  const allKnown = new Map(availableTracks.map(item => [item.fileName, item]));
  const selected = new Map();
  const duplicates = [];
  const unknown = [];
  for (const file of files) {
    if (!allKnown.has(file.name)) { unknown.push(file.name); continue; }
    if (selected.has(file.name)) duplicates.push(file.name);
    else selected.set(file.name, file);
  }
  importPlan = [];
  for (const [name, file] of selected.entries()) {
    const matchedTrack = allKnown.get(name);
    if (matchedTrack) importPlan.push({ track: matchedTrack, file });
  }
  const availableTopics = (typeof topics !== 'undefined' && Array.isArray(topics))
    ? topics
    : (importTopic ? [importTopic] : []);
  const topicGroups = new Map();
  for (const plan of importPlan) {
    const parentTopic = availableTopics.find(t => t.tracks?.includes(plan.track)) || importTopic;
    if (parentTopic) {
      if (!topicGroups.has(parentTopic.id)) topicGroups.set(parentTopic.id, { topic: parentTopic, count: 0 });
      topicGroups.get(parentTopic.id).count++;
    }
  }
  const lines = [`选中 ${importPlan.length} 集音频。`];
  if (topicGroups.size > 1) {
    const summary = Array.from(topicGroups.values()).map(g => `${g.topic.title}（${g.count}/${g.topic.tracks.length} 集）`).join('、');
    lines.push(`跨专题自动识别：${summary}。`);
  } else if (topicGroups.size === 1) {
    const g = Array.from(topicGroups.values())[0];
    lines.push(`对应“${g.topic.title}”（${g.count}/${g.topic.tracks?.length || g.count} 集）。`);
  }
  if (duplicates.length) lines.push(`发现重名文件：${[...new Set(duplicates)].join('、')}。请排除重复文件后重试。`);
  if (unknown.length) lines.push(`不属于课程的 ${unknown.length} 个文件将忽略：${unknown.slice(0, 8).join('、')}${unknown.length > 8 ? '…' : ''}。`);
  if (!importPlan.length) lines.push(`请选择音频文件（如 001.m4a 或各专题音频）。`);
  byId('importPreview').textContent = lines.join('\n');
  byId('btnStartImport').hidden = !importPlan.length;
  byId('btnStartImport').disabled = !!duplicates.length;
  byId('btnStartImport').textContent = `一键导入这 ${importPlan.length} 集`;
}
async function importSelectedFiles() {
  if (importController || downloadController || !importPlan.length || byId('btnStartImport').disabled) return;
  const entries = [...importPlan];
  const selectedTopic = importTopic;
  const controller = new AbortController();
  importController = controller;
  for (const id of ['folderInput', 'filesInput', 'btnStartImport']) byId(id).disabled = true;
  byId('btnStopImport').hidden = false;
  renderList();
  let completed = 0;
  let skipped = 0;
  let currentName = '';
  try {
    for (const entry of entries) {
      if (controller.signal.aborted) throw new DOMException('导入已停止', 'AbortError');
      currentName = entry.track.fileName;
      if (cacheKeys.has(entry.track.id)) { skipped++; continue; }
      byId('importStatus').textContent = `正在导入 ${currentName}（${completed + skipped + 1}/${entries.length}）…请保持页面打开。`;
      await AudioStore.importFile(entry.track, entry.file, controller.signal);
      cacheKeys.add(entry.track.id);
      completed++;
      renderList();
      updateOfflineStatus();
      if (entry.track.id === track.id && !sourceReady) status('本集已导入，点击播放即可收听。');
    }
    const availableTopics = (typeof topics !== 'undefined' && Array.isArray(topics))
      ? topics
      : (selectedTopic ? [selectedTopic] : []);
    const affectedTopics = new Set();
    for (const entry of entries) {
      const parentTopic = availableTopics.find(t => t.tracks?.includes(entry.track)) || selectedTopic;
      if (parentTopic) affectedTopics.add(parentTopic);
    }
    const topicSummaries = Array.from(affectedTopics).map(t => {
      const ready = t.tracks ? t.tracks.filter(item => cacheKeys.has(item.id)).length : completed;
      return `“${t.title}”现有 ${ready}/${t.tracks?.length || ready} 集`;
    }).join('；');
    byId('importStatus').textContent = `本次成功导入 ${completed} 集，已有 ${skipped} 集无需重复导入。${topicSummaries}。全部已就绪内容可随时离线收听。`;
  } catch (error) {
    if (error instanceof Error) byId('importStatus').textContent = `${error.name === 'AbortError' ? '导入已停止' : `${currentName} 导入失败：${error.message}`}。已完成 ${completed} 集，已有 ${skipped} 集；重新选择文件即可继续，已完成内容会保留。`;
    else throw error;
  } finally {
    importController = null;
    for (const id of ['folderInput', 'filesInput', 'btnStartImport']) byId(id).disabled = false;
    byId('btnStopImport').hidden = true;
    renderList();
  }
}
function setupImporter() {
  const label = document.createElement('label');
  label.textContent = '导入私人目录 ';
  const input = document.createElement('input');
  input.id = 'privateCatalogInput';
  input.type = 'file';
  input.accept = '.json,application/json';
  label.append(input);
  byId('importSection').before(label);
  if (!document.getElementById('privateCatalogStatus')) privateCatalogStatus('');
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const incoming = privateCatalog(JSON.parse(await file.text()));
      const entries = readPrivateCatalog();
      for (const item of incoming) {
        const existing = entries.find(entry => entry.id === item.id);
        if (existing) {
          if (existing.bytes !== item.bytes || existing.sha256 !== item.sha256) {
            throw new Error('私人目录 ID 已对应不同音频，请使用新的 ID');
          }
        } else entries.push(item);
      }
      privateCatalog(entries);
      localStorage.setItem('mw_private_catalog', JSON.stringify(entries));
      location.reload();
    } catch (error) {
      if (error instanceof Error) privateCatalogStatus(`私人目录导入失败：${error.message}。原目录未更改。`);
      else throw error;
    }
  });
  for (const id of ['folderInput', 'filesInput']) byId(id).addEventListener('change', event => {
    showImportSelection(Array.from(event.target.files || []));
    event.target.value = '';
  });
  byId('btnStartImport').addEventListener('click', importSelectedFiles);
  byId('btnStopImport').addEventListener('click', () => importController?.abort());
}
