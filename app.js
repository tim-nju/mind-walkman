const topics = [
  { id: 'lixiong', title: '黎雄 · 生命分享', speaker: '黎雄', tracks: [ORIGINAL_TRACK] },
  COURSE_TOPIC
];
const byId = id => document.getElementById(id);
const audio = byId('audioPlayer');
const canFetchTrack = item => !item.privateAudio || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
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
function savePosition() {
  if (!sourceReady) return;
  const position = audio.ended ? 0 : audio.currentTime;
  localStorage.setItem(`mw_pos_${track.id}`, String(position));
  if (track.id === ORIGINAL_TRACK.id) localStorage.setItem('mw_pos', String(position));
}
function savedPosition(item) {
  const raw = localStorage.getItem(`mw_pos_${item.id}`) ??
    (item.id === ORIGINAL_TRACK.id ? localStorage.getItem('mw_pos') : null);
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value < item.duration ? value : 0;
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
    detail.textContent = `${formatTime(item.duration)} · ${cacheKeys.has(item.id) ? '已缓存' : '未缓存'} · 已听 ${formatTime(savedPosition(item))}`;
    button.append(title, detail);
    button.addEventListener('click', () => selectTrack(item, true));
    row.append(button);
    return row;
  }));
  byId('topicCount').textContent = `${topic.tracks.length} 集 · 已缓存 ${topic.tracks.filter(item => cacheKeys.has(item.id)).length} 集`;
  byId('btnPrevious').disabled = topic.tracks.indexOf(track) === 0;
  byId('btnNext').disabled = topic.tracks.indexOf(track) === topic.tracks.length - 1;
  byId('importSection').hidden = topic.id !== COURSE_TOPIC.id;
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
async function selectTrack(next, autoplay = false) {
  savePosition();
  const token = ++selection;
  sourceReady = false;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  if (blobURL) { URL.revokeObjectURL(blobURL); blobURL = null; }
  track = next;
  topic = topics.find(item => item.tracks.includes(track));
  localStorage.setItem('mw_lastTrack', track.id);
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
    status('本集尚未导入。请从 iCloud 的“正解道德经”文件夹导入后播放。');
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
  if (next) selectTrack(next, autoplay);
}
async function playAudio() {
  if (!sourceReady) {
    if (cacheKeys.has(track.id)) await selectTrack(track, true);
    else if (!canFetchTrack(track)) status('请先从 iCloud 文件夹导入本集。');
    return;
  }
  const token = selection;
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
byId('topicSelect').addEventListener('change', event => selectTrack(topics.find(item => item.id === event.target.value).tracks[0]));
byId('btnPrevious').addEventListener('click', () => nextTrack(-1));
byId('btnNext').addEventListener('click', () => nextTrack(1));
byId('btnCacheAll').addEventListener('click', () => downloadTracks([track]));
byId('btnCacheTopic').addEventListener('click', () => downloadTracks([...topic.tracks]));
byId('btnStopCache').addEventListener('click', () => downloadController?.abort());
audio.addEventListener('loadedmetadata', () => {
  if (!audio.getAttribute('src') || audio.readyState < 1) return;
  audio.currentTime = Math.min(pendingPosition, Math.max(0, audio.duration - 0.1));
  pendingPosition = 0;
  sourceReady = true;
  audio.playbackRate = Number(localStorage.getItem('mw_speed')) || 1;
  if (pendingAutoplay) { pendingAutoplay = false; playAudio(); }
  status(audio.paused ? '已就绪' : '正在播放');
  updateProgressUI();
});
audio.addEventListener('error', () => { if (audio.getAttribute('src')) status(cacheKeys.has(track.id) ? '音频解码失败，请核对媒体文件。' : '音频加载失败；请联网重试或先缓存本集。'); });
audio.addEventListener('ended', () => {
  localStorage.setItem(`mw_pos_${track.id}`, '0');
  if (track.id === ORIGINAL_TRACK.id) localStorage.setItem('mw_pos', '0');
  if (loopMode === 'normal') nextTrack(1, true);
});
setInterval(savePosition, 5000);
window.addEventListener('pagehide', savePosition);
document.addEventListener('visibilitychange', () => { if (document.hidden) savePosition(); });
window.addEventListener('online', updateOfflineStatus);
window.addEventListener('offline', updateOfflineStatus);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js?v=9').catch(error => {
  if (error instanceof Error) byId('cacheStatus').textContent = `应用离线壳未就绪：${error.message}`; else throw error;
});
setupControls();
setupImporter();
refreshCache().catch(error => { if (error instanceof Error) status(`缓存不可用：${error.message}`); else throw error; });
selectTrack(track);
