let importPlan = [];
let importController = null;
function showImportSelection(files) {
  if (importController) return;
  const known = new Map(COURSE_TOPIC.tracks.map(item => [item.fileName, item]));
  const selected = new Map();
  const duplicates = [];
  const unknown = [];
  for (const file of files) {
    if (!known.has(file.name)) { unknown.push(file.name); continue; }
    if (selected.has(file.name)) duplicates.push(file.name);
    else selected.set(file.name, file);
  }
  const missing = COURSE_TOPIC.tracks.filter(item => !selected.has(item.fileName));
  importPlan = COURSE_TOPIC.tracks.filter(item => selected.has(item.fileName)).map(item => ({ track: item, file: selected.get(item.fileName) }));
  const lines = [`选中 ${importPlan.length} / ${COURSE_TOPIC.tracks.length} 集。`];
  if (duplicates.length) lines.push(`发现重名文件：${[...new Set(duplicates)].join('、')}。请只选择一份课程文件夹后重试。`);
  if (unknown.length) lines.push(`不属于课程的 ${unknown.length} 个文件将忽略：${unknown.slice(0, 8).join('、')}${unknown.length > 8 ? '…' : ''}。`);
  if (missing.length) lines.push(`本次未选择 ${missing.length} 集：${missing.slice(0, 8).map(item => item.fileName).join('、')}${missing.length > 8 ? '…' : ''}。可以先导入已选集数，之后补齐。`);
  if (!importPlan.length) lines.push('请选择含 001.m4a 至 107.m4a 的“正解道德经”文件夹。');
  byId('importPreview').textContent = lines.join('\n');
  byId('btnStartImport').hidden = !importPlan.length;
  byId('btnStartImport').disabled = !!duplicates.length;
  byId('btnStartImport').textContent = `导入这 ${importPlan.length} 集`;
}
async function importSelectedFiles() {
  if (importController || downloadController || !importPlan.length || byId('btnStartImport').disabled) return;
  const entries = [...importPlan];
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
    const count = COURSE_TOPIC.tracks.filter(item => cacheKeys.has(item.id)).length;
    byId('importStatus').textContent = `本次导入 ${completed} 集，已有 ${skipped} 集无需重复导入。${count === COURSE_TOPIC.tracks.length ? '全部 107 集已就绪，可离线收听。' : `现有 ${count}/107 集；其余集数需继续导入。`}`;
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
  for (const id of ['folderInput', 'filesInput']) byId(id).addEventListener('change', event => {
    showImportSelection(Array.from(event.target.files || []));
    event.target.value = '';
  });
  byId('btnStartImport').addEventListener('click', importSelectedFiles);
  byId('btnStopImport').addEventListener('click', () => importController?.abort());
}
