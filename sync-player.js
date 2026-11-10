import { createListeningSync } from './sync-client.js';
import { mountSyncPanel } from './sync-ui.js';

let client = null;
let connectedOrigin = '';
let unsubscribe = null;
let queue = Promise.resolve();
let pending = 0;
let projecting = false;
let reading = false;
let refreshRequested = false;
let ready = false;
let generation = 0;
const actions = new Map();
const panel = mountSyncPanel(connect);
const messages = {
  unpaired: '尚未授权，收听记录仍保存在本机。',
  unauthorized: '同步授权已失效，请重新授权；本机记录和待上传内容已保留。',
  'reauthorization-required': '同步授权已失效，请重新授权；本机记录和待上传内容已保留。',
  'recovery-required': '服务器数据来源已改变，已暂停同步。请先核对恢复记录。',
  offline: '当前离线，记录保存在本机，联网后自动补传。',
  syncing: '正在自动同步收听记录…',
  synced: '收听记录已同步到服务器。iCloud 自动备份需在 Mac 首次配对后启用。',
  idle: '自动同步已连接。',
  error: '同步暂未完成，记录保存在本机，将自动重试。'
};
Object.assign(messages, {
  activation_required: messages.unpaired, authorization_required: messages.unauthorized,
  source_conflict: messages['recovery-required'],
  sync_origin_mismatch: '服务地址与已授权设备不一致，已停止连接，原记录和授权均保留。',
  backoff: messages.error, network_error: messages.error, storage_error: '本机同步存储暂不可用，请保留此页面和原有收听记录。'
});
function report(error) {
  if (!(error instanceof Error)) throw error;
  panel.setStatus('收听同步未完成，本机原有记录已保留。请检查同步连接状态。', '待检查');
}
function onStatus(value) {
  const state = typeof value === 'string' ? value : value.state;
  const queued = typeof value === 'object' && value.pending > 0;
  panel.setStatus(queued ? '收听记录已保存在本机，等待自动补传。' : messages[state] || messages.error,
    state === 'synced' && !queued ? '已同步' : queued ? '待补传' : '查看状态');
  if (['authorization_required', 'activation_required'].includes(state)) panel.setConnected(false);
  if (state === 'synced') { ready = true; panel.setConnected(true); void project(); }
}
function enqueue(action) {
  generation++;
  pending++;
  queue = queue.then(action).catch(report).finally(() => {
    pending--;
    if (!pending) void project();
  });
  return queue;
}
function catalog() { return allTracks.map(item => ({ id: item.id, duration: item.duration })); }
function markPending() { panel.setStatus('收听记录已保存在本机，等待自动补传。', '待补传'); }
async function project() {
  if (!client || !ready || pending) return;
  if (reading) { refreshRequested = true; return; }
  reading = true;
  const version = generation;
  try {
    const items = [...allTracks];
    const [records, settings] = await Promise.all([
      Promise.all(items.map(item => client.readTrack(item.id))), client.readSettings()
    ]);
    if (pending || version !== generation) { refreshRequested = true; return; }
    projecting = true;
    for (const [index, item] of items.entries()) {
      const value = records[index];
      if (!value) continue;
      localStorage.setItem(`mw_pos_${item.id}`, String(value.positionMs / 1000));
      localStorage.setItem(`mw_progress_${item.id}`, JSON.stringify({
        completed: value.completed, furthest: value.furthestMs / 1000, duration: value.durationMs / 1000
      }));
      if (item.id === ORIGINAL_TRACK.id) localStorage.setItem('mw_pos', String(value.positionMs / 1000));
    }
    if (settings.speed !== undefined) {
      localStorage.setItem('mw_speed', String(settings.speed));
      audio.playbackRate = settings.speed;
      byId('btnSpeed').textContent = `${settings.speed}x`;
    }
    if (settings.loop !== undefined) {
      localStorage.setItem('mw_loop', settings.loop);
      if (loopMode !== 'ab') { loopMode = settings.loop; applyLoop(); }
    }
    if (settings.lastTrack) localStorage.setItem('mw_lastTrack', settings.lastTrack);
    if (audio.paused) {
      const desired = allTracks.find(item => item.id === settings.lastTrack);
      if (desired && desired.id !== track.id) {
        selectTrack(desired, false, false).catch(report);
      } else {
        const value = records[items.findIndex(item => item.id === track.id)];
        if (value) {
          const position = value.positionMs / 1000;
          if (sourceReady && Number.isFinite(audio.duration)) {
            audio.currentTime = Math.min(position, Math.max(0, audio.duration - 0.1));
          } else pendingPosition = position;
        }
      }
    }
    updateListProgress();
    updateProgressUI();
  } catch (error) { report(error); }
  finally {
    projecting = false;
    reading = false;
    if (refreshRequested) { refreshRequested = false; void project(); }
  }
}
async function openClient(origin) {
  if (client && connectedOrigin === origin) return client;
  if (client) { await client.stop(); unsubscribe?.(); actions.clear(); }
  ready = false;
  client = await createListeningSync({
    origin, legacyStorage: localStorage, tracks: catalog(), originalTrackId: ORIGINAL_TRACK.id, onStatus
  });
  connectedOrigin = origin;
  unsubscribe = client.subscribe(() => { void project(); });
  return client;
}
async function connect(origin, secret) {
  // Save the non-secret address before activation so a lost response can recover on reload.
  const parsed = new URL(origin);
  if (parsed.href !== parsed.origin + '/' || parsed.username || parsed.password ||
      (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname)))) {
    throw new Error('invalid_sync_origin');
  }
  const connection = await openClient(parsed.origin);
  localStorage.setItem('mw_sync_origin', parsed.origin);
  const activation = await connection.activate(secret);
  if (activation.state !== 'synced') throw new Error('sync_activation_incomplete');
  await connection.start();
  await connection.flush();
  panel.setConnected(true);
  await project();
  if (!audio.paused) globalThis.ListeningSync.intent(track.id, 'play');
}
globalThis.ListeningSync = {
  isProjecting: () => projecting,
  intent(trackId, kind) {
    if (!client || projecting) return;
    const item = allTracks.find(entry => entry.id === trackId);
    const positionMs = Math.round((track.id === trackId && sourceReady ? audio.currentTime : savedPosition(item)) * 1000);
    const durationMs = Math.round((track.id === trackId && sourceReady && Number.isFinite(audio.duration) ? audio.duration : item.duration || 0) * 1000);
    enqueue(async () => {
      await client.registerTracks(catalog());
      const action = await client.beginAction({ trackId, kind });
      if (!action) return;
      actions.set(trackId, action);
      const result = await client.observe({ trackId, action, positionMs, durationMs, ended: false });
      if (kind === 'select' || kind === 'play' || result.accepted) markPending();
    });
  },
  observe(sample) {
    if (!client || projecting) return;
    enqueue(async () => {
      const action = actions.get(sample.trackId);
      if (action) {
        const result = await client.observe({ ...sample, action });
        if (result.accepted) markPending();
      }
    });
  },
  preference(key, value) {
    if (client && !projecting) enqueue(async () => { await client.setPreference({ key, value }); markPending(); });
  }
};
window.addEventListener('pagehide', () => { if (client) queue.then(() => client.flush()).catch(report); });
try {
  const origin = localStorage.getItem('mw_sync_origin');
  if (origin) {
    panel.setOrigin(origin);
    panel.setConnected(true);
    const connection = await openClient(origin);
    await connection.start();
    await project();
  }
} catch (error) { report(error); }
