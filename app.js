const topics = [
  { id: 'lixiong', title: '黎雄 · 生命分享', speaker: '黎雄', tracks: [ORIGINAL_TRACK] },
  COURSE_TOPIC,
  HOPE_TOPIC,
  BIBLE_TOPIC,
  DIAMOND_TOPIC
];
let privateTracks = [];
try { privateTracks = readPrivateCatalog(); }
catch (error) {
  if (error instanceof Error) privateCatalogStatus(`私人目录读取失败：${error.message}。已保留原数据，修复前不能导入新目录。`);
  else throw error;
}
if (privateTracks.length) topics.push({ id: 'private-library', title: '私人录音', tracks: privateTracks });
const byId = id => document.getElementById(id);
const audio = byId('audioPlayer');
const canFetchTrack = item => !item.localOnly && (!item.privateAudio || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname));
const allTracks = topics.flatMap(topic => topic.tracks);
let track = allTracks.find(item => item.id === localStorage.getItem('mw_lastTrack')) || ORIGINAL_TRACK;
let topic = topics.find(item => item.tracks.includes(track));
let selection = 0;
let sourceReady = false;
let blobURL = null;
let cacheKeys = new Set();
let downloadController = null;
let pendingPosition = 0;
let pendingAutoplay = false;
let loopMode = localStorage.getItem('mw_loop') === 'one' ? 'one' : 'normal';
const status = text => { byId('playerStatus').textContent = text; };
const formatTime = seconds => {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(value / 60).toString().padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
};
// Resume position and completion history are separate: replay must not erase completion.
function readProgress(item) {
  try {
    const value = JSON.parse(localStorage.getItem(`mw_progress_${item.id}`) || 'null');
    if (value && typeof value === 'object' && !Array.isArray(value)) return {
      completed: value.completed === true,
      furthest: Math.max(savedPosition(item), Number.isFinite(value.furthest) && value.furthest >= 0 ? value.furthest : 0),
      duration: Number.isFinite(value.duration) && value.duration > 0 ? value.duration : 0
    };
  } catch { /* A corrupt new record must not hide the legacy bookmark. */ }
  return { completed: false, furthest: savedPosition(item), duration: 0 };
}
function progressLabel(item) {
  const value = readProgress(item);
  if (value.completed) return '已听 100% · 已听完';
  const duration = value.duration || item.duration;
  if (!Number.isFinite(duration) || duration <= 0) return '进度未知';
  // Reserve 100% for an observed ended event, not rounding or seeking near the end.
  return `已听 ${Math.min(99, Math.max(0, Math.floor(value.furthest / duration * 100)))}%`;
}
function updateListProgress() {
  for (const button of byId('trackList').querySelectorAll('[data-track-id]')) {
    const item = allTracks.find(item => item.id === button.dataset.trackId);
    if (item) button.querySelector('small').textContent = `${formatTime(item.duration)} · ${cacheKeys.has(item.id) ? '已缓存' : '未缓存'} · ${progressLabel(item)}`;
  }
}
function savePosition() {
  if (!sourceReady || globalThis.ListeningSync?.isProjecting()) return;
  const position = audio.ended ? 0 : audio.currentTime;
  if (!Number.isFinite(position) || position < 0) return;
  const progress = readProgress(track);
  progress.completed ||= audio.ended;
  progress.furthest = Math.max(progress.furthest, audio.currentTime);
  if (Number.isFinite(audio.duration) && audio.duration > 0) progress.duration = audio.duration;
  localStorage.setItem(`mw_progress_${track.id}`, JSON.stringify(progress));
  localStorage.setItem(`mw_pos_${track.id}`, String(position));
  if (topic) localStorage.setItem(`mw_lastTrack_${topic.id}`, track.id);
  if (track.id === ORIGINAL_TRACK.id) localStorage.setItem('mw_pos', String(position));
  globalThis.ListeningSync?.observe({
    trackId: track.id, positionMs: Math.round(position * 1000),
    durationMs: Math.round(progress.duration * 1000), ended: audio.ended
  });
  updateListProgress();
}
function findActiveTrack(targetTopic) {
  if (!targetTopic || !Array.isArray(targetTopic.tracks) || !targetTopic.tracks.length) return null;
  const rememberedId = localStorage.getItem(`mw_lastTrack_${targetTopic.id}`);
  if (rememberedId) {
    const remembered = targetTopic.tracks.find(item => item.id === rememberedId);
    if (remembered) return remembered;
  }
  const globalLastId = localStorage.getItem('mw_lastTrack');
  if (globalLastId) {
    const globalLast = targetTopic.tracks.find(item => item.id === globalLastId);
    if (globalLast) return globalLast;
  }
  const inProgress = targetTopic.tracks.filter(item => {
    const prog = readProgress(item);
    return savedPosition(item) > 0 && !prog.completed;
  });
  if (inProgress.length > 0) return inProgress[inProgress.length - 1];
  let lastCompletedIndex = -1;
  for (let i = 0; i < targetTopic.tracks.length; i++) {
    if (readProgress(targetTopic.tracks[i]).completed) lastCompletedIndex = i;
  }
  if (lastCompletedIndex >= 0) {
    if (lastCompletedIndex + 1 < targetTopic.tracks.length) {
      return targetTopic.tracks[lastCompletedIndex + 1];
    }
    return targetTopic.tracks[lastCompletedIndex];
  }
  return targetTopic.tracks[0];
}
function scrollToActiveTrack({ behavior = 'smooth', block = 'center', flash = true } = {}) {
  requestAnimationFrame(() => {
    const activeRow = byId('trackList')?.querySelector('[aria-current="true"]');
    if (!activeRow) return;
    activeRow.scrollIntoView({ behavior, block });
    if (flash) {
      activeRow.classList.remove('track-row-locate-pulse');
      void activeRow.offsetWidth;
      activeRow.classList.add('track-row-locate-pulse');
      setTimeout(() => activeRow.classList.remove('track-row-locate-pulse'), 1800);
    }
  });
}
function savedPosition(item) {
  const raw = localStorage.getItem(`mw_pos_${item.id}`) ??
    (item.id === ORIGINAL_TRACK.id ? localStorage.getItem('mw_pos') : null);
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && (!Number.isFinite(item.duration) || item.duration <= 0 || value < item.duration) ? value : 0;
}
function renderList() {
  byId('trackList').replaceChildren(...topic.tracks.map((item, index) => {
    const row = document.createElement('li');
    const button = document.createElement('button');
    button.className = 'track-row';
    button.dataset.trackId = item.id;
    button.setAttribute('aria-current', item.id === track.id ? 'true' : 'false');
    const title = document.createElement('span');
    title.textContent = `${String(index + 1).padStart(3, '0')}  ${item.title}`;
    const detail = document.createElement('small');
    detail.textContent = `${formatTime(item.duration)} · ${cacheKeys.has(item.id) ? '已缓存' : '未缓存'} · ${progressLabel(item)}`;
    button.append(title, detail);
    button.addEventListener('click', () => selectTrack(item, true, true));
    row.append(button);
    return row;
  }));
  byId('topicCount').textContent = `${topic.tracks.length} 集 · 已缓存 ${topic.tracks.filter(item => cacheKeys.has(item.id)).length} 集`;
  byId('btnPrevious').disabled = topic.tracks.indexOf(track) === 0;
  byId('btnNext').disabled = topic.tracks.indexOf(track) === topic.tracks.length - 1;
  byId('importSection').hidden = !topic.tracks.some(item => item.privateAudio) || (track.localOnly && cacheKeys.has(track.id));
  byId('importInstructions').textContent = `在“文件”中选择 iCloud 云盘里的“应用备份 → 心智随身听 → ${topic.backupFolder || '正解道德经'}”文件夹。导入后可离线收听，音频不会上传。`;
  if (track.localOnly) byId('importInstructions').textContent = '选择私人目录对应的本地音频文件。目录和音频仅保存在当前浏览器，不会上传。';
  byId('btnCacheAll').hidden = !canFetchTrack(track);
  byId('btnCacheTopic').hidden = topic.tracks.some(item => !canFetchTrack(item));
  byId('cacheStatus').hidden = !canFetchTrack(track);
  byId('btnCacheAll').disabled = !!importController || !!downloadController || cacheKeys.has(track.id);
  byId('btnCacheAll').textContent = cacheKeys.has(track.id) ? '本集已缓存' : '缓存本集';
  byId('btnCacheTopic').disabled = !!importController || !!downloadController || topic.tracks.every(item => cacheKeys.has(item.id));
}
function updateOfflineStatus() {
  byId('offlineStatus').textContent = cacheKeys.has(track.id) ? '本集可离线' : navigator.onLine ? '本集未缓存' : '断网 · 本集未缓存';
}
async function refreshCache() {
  cacheKeys = new Set(await AudioStore.keys());
  renderList();
  updateOfflineStatus();
}
async function selectTrack(next, autoplay = false, intent = true) {
  savePosition();
  const token = ++selection;
  sourceReady = false;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  if (blobURL) { URL.revokeObjectURL(blobURL); blobURL = null; }
  track = next;
  if (intent) globalThis.ListeningSync?.intent(track.id, 'select');
  if (topic !== topics.find(item => item.tracks.includes(track))) resetImportSelection();
  topic = topics.find(item => item.tracks.includes(track));
  if (intent) {
    localStorage.setItem('mw_lastTrack', track.id);
    if (topic) localStorage.setItem(`mw_lastTrack_${topic.id}`, track.id);
  }
  pendingPosition = savedPosition(track);
  pendingAutoplay = autoplay;
  byId('topicSelect').value = topic.id;
  byId('trackTitle').textContent = track.title;
  document.querySelector('.track-speaker').textContent = track.speaker || topic.speaker;
  document.querySelector('.track-date').textContent = track.date || `${topic.tracks.indexOf(track) + 1} / ${topic.tracks.length} 集`;
  document.querySelector('.quote-box').hidden = track.id !== ORIGINAL_TRACK.id;
  clearAB();
  renderChapters();
  renderList();
  status('正在载入音频…');
  let blob;
  try { blob = await AudioStore.get(track.id); }
  catch (error) { if (error instanceof Error) status(`本地缓存读取失败：${error.message}`); else throw error; }
  if (token !== selection) return;
  if (blob) { blobURL = URL.createObjectURL(blob); audio.src = blobURL; }
  else if (canFetchTrack(track)) audio.src = track.audioSrc;
  else {
    pendingAutoplay = false;
    status(`本集尚未导入。请从 iCloud 的“${topic.backupFolder || '正解道德经'}”文件夹导入后播放。`);
    updateOfflineStatus();
    updateProgressUI();
    return;
  }
  audio.playbackRate = Number(localStorage.getItem('mw_speed')) || 1;
  byId('btnSpeed').textContent = `${audio.playbackRate}x`;
  setupMediaSession();
  updateOfflineStatus();
  audio.load();

}
function nextTrack(offset, autoplay = !audio.paused) {
  const next = topic.tracks[topic.tracks.indexOf(track) + offset];
  if (next) selectTrack(next, autoplay, true);
}
async function playAudio(intent = true) {
  if (!sourceReady) {
    if (cacheKeys.has(track.id)) await selectTrack(track, true, intent);
    else if (!canFetchTrack(track)) status('请先从 iCloud 文件夹导入本集。');
    return;
  }
  const token = selection;
  if (intent) globalThis.ListeningSync?.intent(track.id, 'play');
  try { await audio.play(); if (token === selection) status('正在播放'); }
  catch (error) {
    if (token !== selection || (error instanceof DOMException && error.name === 'AbortError')) return;
    if (error instanceof Error) status(`未能播放，请点击播放重试：${error.message}`); else throw error;
  }
}
async function downloadTracks(items) {
  if (downloadController || importController) return;
  const controller = new AbortController();
  downloadController = controller;
  byId('btnStopCache').hidden = false;
  renderList();
  let completed = 0;
  try {
    for (const item of items) {
      if (controller.signal.aborted) throw new DOMException('下载已停止', 'AbortError');
      if (!cacheKeys.has(item.id)) {
        byId('cacheStatus').textContent = `缓存 ${completed + 1}/${items.length}：${item.title}`;
        await AudioStore.download(item, controller.signal);
        cacheKeys.add(item.id);
      }
      completed++;
      renderList();
      updateOfflineStatus();
    }
    byId('cacheStatus').textContent = `${completed} 集已缓存，可离线播放；浏览器清理存储会移除缓存。`;
  } catch (error) {
    if (error instanceof Error) byId('cacheStatus').textContent = `${error.name === 'AbortError' ? '缓存已停止' : `缓存失败：${error.message}`}；已完成 ${completed} 集，重试会保留已有缓存。`;
    else throw error;
  } finally {
    downloadController = null;
    byId('btnStopCache').hidden = true;
    renderList();
  }
}
byId('topicSelect').replaceChildren(...topics.map(item => new Option(item.title, item.id)));
byId('topicSelect').addEventListener('change', event => {
  const nextTopic = topics.find(item => item.id === event.target.value);
  if (!nextTopic) return;
  const targetTrack = findActiveTrack(nextTopic);
  selectTrack(targetTrack, false, true);
  scrollToActiveTrack({ behavior: 'smooth', block: 'center', flash: true });
});
byId('btnPrevious').addEventListener('click', () => nextTrack(-1));
byId('btnNext').addEventListener('click', () => nextTrack(1));
byId('btnLocateInList')?.addEventListener('click', () => scrollToActiveTrack({ behavior: 'smooth', block: 'center', flash: true }));
byId('btnLocateTrack')?.addEventListener('click', () => scrollToActiveTrack({ behavior: 'smooth', block: 'center', flash: true }));
byId('btnCacheAll').addEventListener('click', () => downloadTracks([track]));
byId('btnCacheTopic').addEventListener('click', () => downloadTracks([...topic.tracks]));
byId('btnStopCache').addEventListener('click', () => downloadController?.abort());
audio.addEventListener('loadedmetadata', () => {
  if (!audio.getAttribute('src') || audio.readyState < 1) return;
  audio.currentTime = Math.min(pendingPosition, Math.max(0, audio.duration - 0.1));
  pendingPosition = 0;
  sourceReady = true;
  audio.playbackRate = Number(localStorage.getItem('mw_speed')) || 1;
  if (pendingAutoplay) { pendingAutoplay = false; playAudio(false); }
  status(audio.paused ? '已就绪' : '正在播放');
  updateProgressUI();
});
audio.addEventListener('error', () => { if (audio.getAttribute('src')) status(cacheKeys.has(track.id) ? '音频解码失败，请核对媒体文件。' : '音频加载失败；请联网重试或先缓存本集。'); });
audio.addEventListener('ended', () => {
  if (!sourceReady) return;
  savePosition();
  if (loopMode === 'one') {
    audio.currentTime = 0;
    playAudio(false);
  } else if (loopMode === 'normal') nextTrack(1, true);
});
audio.addEventListener('pause', savePosition);
setInterval(savePosition, 5000);
window.addEventListener('pagehide', savePosition);
document.addEventListener('visibilitychange', () => { if (document.hidden) savePosition(); });
window.addEventListener('online', updateOfflineStatus);
window.addEventListener('offline', updateOfflineStatus);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js?v=15').catch(error => {
  if (error instanceof Error) byId('cacheStatus').textContent = `应用离线壳未就绪：${error.message}`; else throw error;
});
setupControls();
setupImporter();
refreshCache().catch(error => { if (error instanceof Error) status(`缓存不可用：${error.message}`); else throw error; });
selectTrack(track, false, false);
