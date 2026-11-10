let pointA = null;
let pointB = null;
function applyLoop() {
  // Handle single-track repeat in ended so completion is persisted before replay.
  audio.loop = false;
  byId('btnLoop').textContent = loopMode === 'one' ? '单曲循环' : loopMode === 'ab' ? 'A-B 复读' : '顺次播放';
  byId('btnLoop').classList.toggle('active', loopMode !== 'normal');
}
function clearAB() {
  pointA = null;
  pointB = null;
  byId('markerA').style.display = 'none';
  byId('markerB').style.display = 'none';
  if (loopMode === 'ab') loopMode = localStorage.getItem('mw_loop') === 'one' ? 'one' : 'normal';
  byId('abStatusText').textContent = '点击【设为 A】选择复读起点';
  applyLoop();
}
function seekTo(seconds) {
  if (!sourceReady || !Number.isFinite(audio.duration)) return;
  globalThis.ListeningSync?.intent(track.id, 'seek');
  audio.currentTime = Math.min(Math.max(0, seconds), audio.duration);
  savePosition();
  updateProgressUI();
}
function renderChapters() {
  const chapters = track.chapters || [];
  document.querySelector('.chapters-section').hidden = !chapters.length;
  byId('activeChapterPill').hidden = !chapters.length;
  byId('chapterList').replaceChildren(...chapters.map(chapter => {
    const button = document.createElement('button');
    button.className = 'chapter-card';
    const badge = document.createElement('span');
    badge.className = 'chapter-badge';
    badge.textContent = formatTime(chapter.start);
    const content = document.createElement('span');
    content.className = 'chapter-content';
    const title = document.createElement('span');
    title.className = 'chapter-title';
    title.textContent = chapter.title;
    const quote = document.createElement('span');
    quote.className = 'chapter-quote';
    quote.textContent = chapter.quote || '';
    content.append(title, quote);
    button.append(badge, content);
    button.addEventListener('click', () => { seekTo(chapter.start); playAudio(); });
    return button;
  }));
}
function updateProgressUI() {
  const duration = Number.isFinite(audio.duration) ? audio.duration : track.duration;
  const current = sourceReady ? audio.currentTime : 0;
  const percent = duration ? current / duration * 100 : 0;
  byId('progressCurrent').style.width = `${percent}%`;
  byId('progressHandle').style.left = `${percent}%`;
  byId('timeCurrent').textContent = formatTime(current);
  byId('timeTotal').textContent = formatTime(duration);
  byId('seekInput').max = String(duration);
  byId('seekInput').value = String(current);
  if (loopMode === 'ab' && pointA !== null && pointB !== null && current >= pointB) audio.currentTime = pointA;
  const chapters = track.chapters || [];
  const active = chapters.findLastIndex(chapter => chapter.start <= current);
  document.querySelectorAll('.chapter-card').forEach((card, index) => card.classList.toggle('active', index === active));
  if (active >= 0) byId('activeChapterText').textContent = chapters[active].title;
  if ('mediaSession' in navigator && Number.isFinite(audio.duration) && audio.duration > 0) {
    navigator.mediaSession.setPositionState({ duration: audio.duration, playbackRate: audio.playbackRate, position: Math.min(current, audio.duration) });
  }
}
function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title, artist: track.speaker || topic.speaker, album: topic.title,
    artwork: [{ src: './public/icons/icon-512.png', sizes: '512x512', type: 'image/png' }]
  });
  const handlers = {
    play: playAudio, pause: () => audio.pause(),
    seekbackward: detail => seekTo(audio.currentTime - (detail.seekOffset || 15)),
    seekforward: detail => seekTo(audio.currentTime + (detail.seekOffset || 30)),
    seekto: detail => seekTo(detail.seekTime),
    previoustrack: () => nextTrack(-1), nexttrack: () => nextTrack(1)
  };
  for (const [action, handler] of Object.entries(handlers)) {
    try { navigator.mediaSession.setActionHandler(action, handler); }
    catch (error) { if (!(error instanceof DOMException && error.name === 'NotSupportedError')) throw error; }
  }
}
function setupControls() {
  byId('btnPlay').addEventListener('click', () => audio.paused ? playAudio() : audio.pause());
  byId('btnSkipBack').addEventListener('click', () => seekTo(audio.currentTime - 15));
  byId('btnSkipForward').addEventListener('click', () => seekTo(audio.currentTime + 30));
  byId('seekInput').addEventListener('input', event => seekTo(Number(event.target.value)));
  byId('btnSpeed').addEventListener('click', () => {
    const speeds = [0.8, 1, 1.25, 1.5, 2];
    audio.playbackRate = speeds[(speeds.indexOf(audio.playbackRate) + 1) % speeds.length];
    localStorage.setItem('mw_speed', String(audio.playbackRate));
    globalThis.ListeningSync?.preference('speed', audio.playbackRate);
    byId('btnSpeed').textContent = `${audio.playbackRate}x`;
  });
  byId('btnLoop').addEventListener('click', () => {
    clearAB();
    loopMode = loopMode === 'one' ? 'normal' : 'one';
    localStorage.setItem('mw_loop', loopMode);
    globalThis.ListeningSync?.preference('loop', loopMode);
    applyLoop();
  });
  byId('btnAB').addEventListener('click', () => {
    const panel = byId('abPanel');
    const opened = panel.style.display !== 'none';
    panel.style.display = opened ? 'none' : 'flex';
    byId('btnAB').setAttribute('aria-expanded', String(!opened));
    if (opened) clearAB();
  });
  byId('btnSetA').addEventListener('click', () => {
    pointA = audio.currentTime;
    pointB = null;
    byId('markerA').style.cssText = `left:${pointA / audio.duration * 100}%;display:block`;
    byId('markerB').style.display = 'none';
    byId('abStatusText').textContent = `A ${formatTime(pointA)}；请选择更晚的 B 点`;
  });
  byId('btnSetB').addEventListener('click', () => {
    const start = pointA ?? 0;
    if (audio.currentTime <= start) { byId('abStatusText').textContent = 'B 点必须晚于 A 点'; return; }
    pointA = start;
    pointB = audio.currentTime;
    loopMode = 'ab';
    applyLoop();
    byId('markerB').style.cssText = `left:${pointB / audio.duration * 100}%;display:block`;
    byId('abStatusText').textContent = `复读 ${formatTime(pointA)} 至 ${formatTime(pointB)}`;
    seekTo(pointA);
  });
  byId('btnClearAB').addEventListener('click', clearAB);
  audio.addEventListener('timeupdate', updateProgressUI);
  for (const event of ['play', 'pause']) audio.addEventListener(event, () => {
    document.querySelector('.icon-play').style.display = audio.paused ? 'block' : 'none';
    document.querySelector('.icon-pause').style.display = audio.paused ? 'none' : 'block';
    document.querySelector('.player-card').classList.toggle('is-playing', !audio.paused);
    byId('btnPlay').setAttribute('aria-label', audio.paused ? '播放' : '暂停');
    if (sourceReady) status(audio.ended ? '本集播放完毕' : audio.paused ? '已暂停' : '正在播放');
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
  });
}
