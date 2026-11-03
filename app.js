// Track Data: 黎雄《从极致追求物质成功到重新认识生命》
const TRACK_DATA = {
  id: "lixiong-20261031",
  title: "从极致追求物质成功到重新认识生命",
  speaker: "黎雄",
  date: "2026-10-31 线下聚会原声",
  duration: 4612, // 01:16:52
  audioSrc: "./public/audio/lixiong-20261031.mp3",
  cover: "./public/icons/icon-512.png",
  chapters: [
    {
      start: 0,
      title: "缘起与重生：追求物质到重新认识生命",
      quote: "借好朋友思波的生日会，定下这个主题，概括了过去一年翻天覆地的转变，也是自己的一种重生。"
    },
    {
      start: 150,
      title: "岁月流转：二宝出生短片引发的沉思",
      quote: "看二宝现在去读幼儿园，昨天我第一次以爸爸名义参加万圣节活动。经历许多后，真正觉得低谷是一份礼物。"
    },
    {
      start: 360,
      title: "匮乏与高光：从农村出身到年入数百万",
      quote: "农村出身有过物质匮乏与被轻视，所以极度渴望名利认可。27岁年入数百万，顿顿十菜一汤、奢华消费过了七年。"
    },
    {
      start: 750,
      title: "恐惧驱动：怕穷、怕被否定、怕得罪人的精神内耗",
      quote: "以前更多是恐惧驱动：害怕未来赚不到钱，焦虑外界负面评价，害怕拒绝别人，看似风光实则如履薄冰。"
    },
    {
      start: 1214,
      title: "认知觉醒：没有人可以伤害我，除非我允许",
      quote: "一个人伤不伤害你，决定权在你怎么去解读它。停止一切无谓的证明与内耗，允许误解，把评判交给时间。"
    },
    {
      start: 1500,
      title: "坚决断舍离：卖房还债，月供6万清零的轻松",
      quote: "破除亏本不舍得卖房的执念，坚决把所有房子卖掉清偿债务。以前每月6万房贷，现在月供是零，轻装上阵。"
    },
    {
      start: 2150,
      title: "现金流心法：放下资产执念，每天省下两千块",
      quote: "哪怕现在啥都不做，每天比以前省出两千块。放下重资产执念，现金流自由，心态彻底释然。"
    },
    {
      start: 2490,
      title: "科学看待健康：打破精神心理疾病的病耻感",
      quote: "打破病耻感，不听信偏方或恐慌言论，严格遵照现代医学科学治疗和足疗程服药，身心重新恢复平衡。"
    },
    {
      start: 2880,
      title: "用心良甜：赠人玫瑰手有余香，不求未来回报",
      quote: "给辛苦的滴滴司机多发红包、体恤发型师。彼此当下交流滋养就是关系的全部回报，不带交易心态期待未来。"
    },
    {
      start: 3240,
      title: "生命脆弱性：同龄朋友的悲剧带来的深刻警醒",
      quote: "目睹身边同龄人因财务断裂自杀给父母带来灭顶之灾。钱永远赚不完，但生命只有一次，人要珍惜活着的权利。"
    },
    {
      start: 3760,
      title: "主动制造微不适：微寒与饥饿唤醒本能的感恩",
      quote: "人对长期舒适容易脱敏。主动体验一点冷与劳作，当回到温暖日常时，内心便能自然升起对平凡生活的无限感恩。"
    },
    {
      start: 4200,
      title: "亲情和解：向姐姐袒露脆弱，回归真实烟火气",
      quote: "生病最绝望时向姐姐求助，痛哭一场卸下伪装。不再盲目焦虑听课，享受给家人买菜做饭，生活越朴素内心越丰盈。"
    }
  ]
};

// DOM Elements
const audio = document.getElementById('audioPlayer');
const btnPlay = document.getElementById('btnPlay');
const iconPlay = btnPlay.querySelector('.icon-play');
const iconPause = btnPlay.querySelector('.icon-pause');
const btnSkipBack = document.getElementById('btnSkipBack');
const btnSkipForward = document.getElementById('btnSkipForward');
const btnSpeed = document.getElementById('btnSpeed');
const btnLoop = document.getElementById('btnLoop');
const btnAB = document.getElementById('btnAB');
const abPanel = document.getElementById('abPanel');
const btnSetA = document.getElementById('btnSetA');
const btnSetB = document.getElementById('btnSetB');
const btnClearAB = document.getElementById('btnClearAB');
const abStatusText = document.getElementById('abStatusText');
const markerA = document.getElementById('markerA');
const markerB = document.getElementById('markerB');
const timeCurrent = document.getElementById('timeCurrent');
const timeTotal = document.getElementById('timeTotal');
const progressBar = document.getElementById('progressBar');
const progressCurrent = document.getElementById('progressCurrent');
const progressBuffered = document.getElementById('progressBuffered');
const progressHandle = document.getElementById('progressHandle');
const chapterList = document.getElementById('chapterList');
const activeChapterPill = document.getElementById('activeChapterPill');
const activeChapterText = document.getElementById('activeChapterText');
const playerCard = document.querySelector('.player-card');
const btnCacheAll = document.getElementById('btnCacheAll');

// State
let isPlaying = false;
let currentSpeedIndex = 1;
const SPEEDS = [0.8, 1.0, 1.25, 1.5, 2.0];
let loopMode = 'one'; // 'one', 'normal', 'ab'
let pointA = null;
let pointB = null;
let currentChapterIndex = -1;

// Format seconds into HH:MM:SS or MM:SS
function formatTime(sec) {
  if (isNaN(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const ss = String(s).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

// Render Chapters List
function renderChapters() {
  chapterList.innerHTML = '';
  TRACK_DATA.chapters.forEach((ch, idx) => {
    const card = document.createElement('div');
    card.className = 'chapter-card';
    card.id = `chapter-card-${idx}`;
    card.innerHTML = `
      <span class="chapter-badge">${formatTime(ch.start)}</span>
      <div class="chapter-content">
        <h4 class="chapter-title">${ch.title}</h4>
        <p class="chapter-quote">“${ch.quote}”</p>
      </div>
    `;
    card.addEventListener('click', () => {
      seekTo(ch.start);
      if (!isPlaying) playAudio();
    });
    chapterList.appendChild(card);
  });
}

// MediaSession Integration for iOS Lock Screen & Headset Controls
function setupMediaSession() {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: TRACK_DATA.title,
      artist: TRACK_DATA.speaker,
      album: '心智随身听',
      artwork: [
        { src: './public/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: './public/icons/icon-512.png', sizes: '512x512', type: 'image/png' }
      ]
    });

    navigator.mediaSession.setActionHandler('play', () => playAudio());
    navigator.mediaSession.setActionHandler('pause', () => pauseAudio());
    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      skip(- (details.seekOffset || 15));
    });
    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      skip(details.seekOffset || 30);
    });
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined) {
        seekTo(details.seekTime);
      }
    });
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      // Jump to previous chapter
      if (currentChapterIndex > 0) {
        seekTo(TRACK_DATA.chapters[currentChapterIndex - 1].start);
      } else {
        seekTo(0);
      }
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      // Jump to next chapter
      if (currentChapterIndex < TRACK_DATA.chapters.length - 1) {
        seekTo(TRACK_DATA.chapters[currentChapterIndex + 1].start);
      }
    });
  }
}

// Play / Pause Functions
function playAudio() {
  audio.play().then(() => {
    isPlaying = true;
    iconPlay.style.display = 'none';
    iconPause.style.display = 'block';
    playerCard.classList.add('is-playing');
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'playing';
    }
  }).catch((err) => {
    console.warn('Playback error / User interaction needed:', err);
  });
}

function pauseAudio() {
  audio.pause();
  isPlaying = false;
  iconPlay.style.display = 'block';
  iconPause.style.display = 'none';
  playerCard.classList.remove('is-playing');
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = 'paused';
  }
}

function togglePlay() {
  if (isPlaying) {
    pauseAudio();
  } else {
    playAudio();
  }
}

function skip(seconds) {
  const target = Math.min(Math.max(0, audio.currentTime + seconds), audio.duration || TRACK_DATA.duration);
  seekTo(target);
}

function seekTo(seconds) {
  audio.currentTime = seconds;
  updateProgressUI();
  savePosition();
}

// Update Active Chapter UI
function updateActiveChapter(currentTime) {
  let activeIdx = -1;
  for (let i = TRACK_DATA.chapters.length - 1; i >= 0; i--) {
    if (currentTime >= TRACK_DATA.chapters[i].start) {
      activeIdx = i;
      break;
    }
  }

  if (activeIdx !== currentChapterIndex) {
    currentChapterIndex = activeIdx;
    
    // Update Chapter Pill
    if (activeIdx >= 0) {
      const ch = TRACK_DATA.chapters[activeIdx];
      activeChapterText.textContent = `${formatTime(ch.start)} ${ch.title}`;
    }

    // Update List Cards
    document.querySelectorAll('.chapter-card').forEach((card, idx) => {
      if (idx === activeIdx) {
        card.classList.add('active');
        // Scroll active into view smoothly if not visible
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        card.classList.remove('active');
      }
    });
  }
}

// Progress Bar & Scrubbing
function updateProgressUI() {
  const duration = audio.duration || TRACK_DATA.duration;
  const current = audio.currentTime || 0;
  const percent = duration > 0 ? (current / duration) * 100 : 0;
  
  progressCurrent.style.width = `${percent}%`;
  progressHandle.style.left = `${percent}%`;
  timeCurrent.textContent = formatTime(current);
  timeTotal.textContent = formatTime(duration);

  // A-B loop check
  if (loopMode === 'ab' && pointA !== null && pointB !== null) {
    if (current >= pointB) {
      audio.currentTime = pointA;
    }
  }

  updateActiveChapter(current);
}

// Scrubber Click & Drag Handlers
function setupScrubber() {
  let isDragging = false;

  const handleSeek = (e) => {
    const rect = progressBar.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clickX = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percent = clickX / rect.width;
    const duration = audio.duration || TRACK_DATA.duration;
    seekTo(percent * duration);
  };

  progressBar.addEventListener('mousedown', (e) => {
    isDragging = true;
    handleSeek(e);
  });
  window.addEventListener('mousemove', (e) => {
    if (isDragging) handleSeek(e);
  });
  window.addEventListener('mouseup', () => {
    isDragging = false;
  });

  progressBar.addEventListener('touchstart', (e) => {
    isDragging = true;
    handleSeek(e);
  }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (isDragging) handleSeek(e);
  }, { passive: true });
  window.addEventListener('touchend', () => {
    isDragging = false;
  });
}

// Speed Toggle
btnSpeed.addEventListener('click', () => {
  currentSpeedIndex = (currentSpeedIndex + 1) % SPEEDS.length;
  const speed = SPEEDS[currentSpeedIndex];
  audio.playbackRate = speed;
  btnSpeed.textContent = `${speed}x`;
  localStorage.setItem('mw_speed', speed);
});

// Loop Mode Toggle
btnLoop.addEventListener('click', () => {
  if (loopMode === 'one') {
    loopMode = 'normal';
    audio.loop = false;
    btnLoop.textContent = '➡️ 顺次播放';
    btnLoop.classList.remove('active');
  } else {
    loopMode = 'one';
    audio.loop = true;
    btnLoop.textContent = '🔂 单曲循环';
    btnLoop.classList.add('active');
  }
  localStorage.setItem('mw_loop', loopMode);
});

// A-B Repeat Mode
btnAB.addEventListener('click', () => {
  if (abPanel.style.display === 'none') {
    abPanel.style.display = 'flex';
    btnAB.classList.add('active');
  } else {
    abPanel.style.display = 'none';
    btnAB.classList.remove('active');
    clearAB();
  }
});

btnSetA.addEventListener('click', () => {
  pointA = audio.currentTime;
  const duration = audio.duration || TRACK_DATA.duration;
  markerA.style.left = `${(pointA / duration) * 100}%`;
  markerA.style.display = 'block';
  abStatusText.textContent = `A点已设: ${formatTime(pointA)}，请播放并点击【设为B】`;
});

btnSetB.addEventListener('click', () => {
  if (pointA === null) {
    pointA = 0;
  }
  pointB = audio.currentTime;
  if (pointB <= pointA) {
    pointB = pointA + 5;
  }
  const duration = audio.duration || TRACK_DATA.duration;
  markerB.style.left = `${(pointB / duration) * 100}%`;
  markerB.style.display = 'block';
  loopMode = 'ab';
  btnLoop.textContent = '🔁 A-B 复读';
  btnLoop.classList.add('active');
  abStatusText.textContent = `正在复读: ${formatTime(pointA)} ↔ ${formatTime(pointB)}`;
  audio.currentTime = pointA;
});

function clearAB() {
  pointA = null;
  pointB = null;
  markerA.style.display = 'none';
  markerB.style.display = 'none';
  loopMode = 'one';
  audio.loop = true;
  btnLoop.textContent = '🔂 单曲循环';
  abStatusText.textContent = '点击【设为A】选择复读起点';
}

btnClearAB.addEventListener('click', clearAB);

// Event Listeners on Audio
audio.addEventListener('timeupdate', updateProgressUI);
audio.addEventListener('loadedmetadata', () => {
  timeTotal.textContent = formatTime(audio.duration || TRACK_DATA.duration);
});
audio.addEventListener('play', () => {
  isPlaying = true;
  iconPlay.style.display = 'none';
  iconPause.style.display = 'block';
  playerCard.classList.add('is-playing');
});
audio.addEventListener('pause', () => {
  isPlaying = false;
  iconPlay.style.display = 'block';
  iconPause.style.display = 'none';
  playerCard.classList.remove('is-playing');
});
audio.addEventListener('ended', () => {
  if (loopMode === 'one') {
    audio.currentTime = 0;
    playAudio();
  } else {
    pauseAudio();
  }
});

btnPlay.addEventListener('click', togglePlay);
btnSkipBack.addEventListener('click', () => skip(-15));
btnSkipForward.addEventListener('click', () => skip(30));

// IndexedDB Audio Storage Helper for iOS Hardware-Level Offline Caching
const DB_NAME = 'MindWalkmanDB';
const DB_VERSION = 1;
const STORE_NAME = 'audio_files';

function openAudioDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getStoredAudio(id) {
  try {
    const db = await openAudioDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    console.warn('IndexedDB read error:', err);
    return null;
  }
}

async function saveStoredAudio(id, blob) {
  try {
    const db = await openAudioDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(blob, id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('IndexedDB write error:', err);
    throw err;
  }
}

async function checkLocalAudioCache() {
  try {
    const blob = await getStoredAudio(TRACK_DATA.id);
    if (blob) {
      const currentPos = audio.currentTime;
      audio.src = URL.createObjectURL(blob);
      if (currentPos > 0) audio.currentTime = currentPos;
      btnCacheAll.textContent = '✅ 已完全离线';
      btnCacheAll.disabled = true;
      document.getElementById('offlineStatus').textContent = '⚡ 本地闪存就绪';
      return true;
    }
  } catch (e) {
    console.warn('Local cache check failed:', e);
  }
  return false;
}

// Position Persistence
function savePosition() {
  if (audio.currentTime > 5) {
    localStorage.setItem('mw_pos', audio.currentTime);
  }
}
setInterval(savePosition, 5000);

function restorePosition() {
  const savedPos = parseFloat(localStorage.getItem('mw_pos'));
  if (!isNaN(savedPos) && savedPos > 0 && savedPos < TRACK_DATA.duration) {
    audio.currentTime = savedPos;
    updateProgressUI();
  }
  const savedSpeed = parseFloat(localStorage.getItem('mw_speed'));
  if (!isNaN(savedSpeed) && SPEEDS.includes(savedSpeed)) {
    audio.playbackRate = savedSpeed;
    btnSpeed.textContent = `${savedSpeed}x`;
    currentSpeedIndex = SPEEDS.indexOf(savedSpeed);
  }
}

// Offline Caching Action (Streaming Download + IndexedDB + CacheStorage)
btnCacheAll.addEventListener('click', async () => {
  btnCacheAll.disabled = true;
  btnCacheAll.textContent = '⏳ 连接中...';

  try {
    const response = await fetch(TRACK_DATA.audioSrc);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const contentLength = +response.headers.get('Content-Length') || (52.8 * 1024 * 1024);
    let receivedLength = 0;
    const reader = response.body.getReader();
    const chunks = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      receivedLength += value.length;
      const pct = Math.min(99, Math.floor((receivedLength / contentLength) * 100));
      btnCacheAll.textContent = `📥 ${pct}%`;
    }

    btnCacheAll.textContent = '💾 写入闪存...';
    const audioBlob = new Blob(chunks, { type: 'audio/mpeg' });

    // 1. Save to IndexedDB (Hardware flash persistent)
    await saveStoredAudio(TRACK_DATA.id, audioBlob);

    // 2. Put into Service Worker CacheStorage
    try {
      const cache = await caches.open('mind-walkman-v2');
      await cache.put(TRACK_DATA.audioSrc, new Response(audioBlob, {
        headers: {
          'Content-Type': 'audio/mpeg',
          'Content-Length': String(audioBlob.size),
          'Accept-Ranges': 'bytes'
        }
      }));
    } catch (e) {
      console.warn('SW cache put error:', e);
    }

    // 3. Switch audio player source to local object URL immediately
    const currentPos = audio.currentTime;
    const wasPlaying = !audio.paused;
    audio.src = URL.createObjectURL(audioBlob);
    audio.currentTime = currentPos;
    if (wasPlaying) audio.play();

    btnCacheAll.textContent = '✅ 已完全离线';
    btnCacheAll.disabled = true;
    document.getElementById('offlineStatus').textContent = '⚡ 本地闪存就绪';
    alert('🎉 52.8MB 录音已完全存入手机硬件闪存！\n\n即使开启飞行模式或进入无网络地铁隧道，点开图标也能秒开秒播。');
  } catch (err) {
    console.error('Download error:', err);
    btnCacheAll.disabled = false;
    btnCacheAll.textContent = '⚠️ 缓存重试';
    alert('离线缓存失败，请检查网络后重试：' + err.message);
  }
});

// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      console.log('Service Worker registered successfully:', reg.scope);
    }).catch((err) => {
      console.warn('Service Worker registration failed:', err);
    });
  });
}

// Online/Offline Indicator
window.addEventListener('offline', () => {
  document.getElementById('offlineStatus').textContent = '✈️ 离线可用';
});
window.addEventListener('online', () => {
  checkLocalAudioCache().then((isCached) => {
    if (isCached) {
      document.getElementById('offlineStatus').textContent = '⚡ 本地闪存就绪';
    } else {
      document.getElementById('offlineStatus').textContent = '⚡ 在线模式';
    }
  });
});

// Initialization
renderChapters();
setupScrubber();
setupMediaSession();
restorePosition();
checkLocalAudioCache();
audio.loop = true; // Default to single repeat for commute immersion
