import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

class EvidenceError extends Error {
  constructor(field) { super(`私人录音证据无效: ${field}`); this.name = 'EvidenceError'; }
}
const requireValue = (condition, field) => { if (!condition) throw new EvidenceError(field); };
const digest = data => createHash('sha256').update(data).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const positive = value => number(value) && value > 0;
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function fresh(value, sources) {
  requireValue(object(value), 'sources');
  for (const [name, hash] of Object.entries(sources)) requireValue(value[name] === hash, `过期源码 ${name}`);
}
async function fingerprint(item) {
  requireValue(object(item) && text(item.path) && sha(item.sha256), '制品指纹字段');
  const bytes = await fs.readFile(item.path);
  requireValue(bytes.length > 0 && digest(bytes) === item.sha256, `过期或篡改制品 ${item.path}`);
  return bytes;
}
function mediaEqual(left, right) {
  requireValue(Array.isArray(left) && left.length === right.length, '场景媒体集合');
  for (const expected of right) {
    const rows = left.filter(row => object(row) && row.role === expected.role);
    requireValue(rows.length === 1 && rows[0].path === expected.path && rows[0].sha256 === expected.sha256 &&
      rows[0].bytes === expected.bytes, `过期媒体 ${expected.role}`);
  }
}
function observations(id, o, candidate) {
  requireValue(object(o), `${id} observations`);
  const truths = keys => requireValue(keys.every(key => o[key] === true), `${id} 实际场景结果`);
  const advancing = (start, end) => number(o[start]) && positive(o[end]) && o[end] > o[start] + 0.1;
  switch (id) {
    case 'private-catalog-and-real-file-input':
      truths(['catalogChosen', 'audioChosen']);
      requireValue(o.importedBytes === candidate.bytes && positive(o.duration), '实际导入 bytes/duration');
      break;
    case 'corrupt-catalog-and-media-rejected':
      truths(['collisionRejectedBeforeWrite', 'oldMetadataAndAudioRetained', 'mergedTracksRetained',
        'duplicateRejected', 'pathRejected', 'quotaVisible', 'securityVisible', 'malformedPreserved',
        'malformedRecovered', 'sameSizeCorruptionRejected']);
      break;
    case 'play-seek-resume-offline-cold-reopen':
      truths(['serverStopped', 'browserRestarted']);
      requireValue(positive(o.duration) && advancing('playStart', 'playEnd') &&
        advancing('nearEndStart', 'nearEndEnd') && o.nearEndStart > o.duration - 60 &&
        o.nearEndEnd < o.duration && number(o.resumeTime) && Math.abs(o.resumeTime - o.nearEndEnd) <= 3 &&
        advancing('offlineStart', 'offlineEnd') && Math.abs(o.offlineStart - o.resumeTime) <= 3 &&
        o.offlineEnd <= o.duration, '播放/末段/续播/冷启动时间线');
      break;
    case 'existing-tracks-and-bookmarks-preserved':
      requireValue(positive(o.originalBytes) && o.courseTracks === 107 && o.hopeTracks === 1 &&
        positive(o.bookmarkBefore) && o.bookmarkBefore === o.bookmarkAfter, '旧曲目/书签保留');
      break;
    case 'private-media-http-denied':
      requireValue(o.catalogStatus === 403 && o.mediaStatus === 403, '私人 HTTP 状态');
      break;
    case 'ios-files-playback-and-offline':
      truths(['systemFiles', 'offlineColdReopen', 'downstreamRead']);
      requireValue(advancing('playStart', 'playEnd') && advancing('offlineStart', 'offlineEnd'), 'iOS 播放时间');
      break;
    case 'independent-coverage-code-architecture-review':
      requireValue(text(o.taskId) && /^st_/.test(o.taskId) &&
        ['coverage', 'code', 'architecture', 'visual'].every(key => o[key] === 'pass'), '独立审阅结果');
      break;
    case 'shell-upgrade-and-final-fingerprint':
      requireValue(o.fromVersion === 11 && o.toVersion === 12 && positive(o.oldAudioBytes) &&
        o.oldAudioBytes === o.newAudioBytes && positive(o.bookmarkBefore) &&
        o.bookmarkBefore === o.bookmarkAfter && text(o.controller) && o.controller.endsWith('/sw.js?v=12') &&
        advancing('offlineStart', 'offlineEnd'), 'v11 到 v12 升级保留/离线');
      break;
    default: throw new EvidenceError(`未知场景 ${id}`);
  }
}

/** Parse untrusted final JSON and bind every scenario to its final inputs and measured artifacts. */
export async function validatePrivateRecording(value, required, sources) {
  requireValue(object(value) && value.schema === 'private-recording-final/v1' && value.status === 'pass', '最终 schema/status');
  fresh(value.sources, sources);
  requireValue(Array.isArray(value.media) && value.media.length === 3, '最终媒体集合');
  for (const role of ['original', 'candidate', 'catalog']) {
    const rows = value.media.filter(row => object(row) && row.role === role);
    requireValue(rows.length === 1 && Number.isSafeInteger(rows[0].bytes) && rows[0].bytes > 0, `媒体 ${role}`);
    requireValue((await fingerprint(rows[0])).length === rows[0].bytes, `媒体 bytes ${role}`);
  }
  requireValue(new Set(value.media.map(row => path.resolve(row.path))).size === 3, '媒体角色路径重复');
  const original = value.media.find(row => row.role === 'original');
  const candidate = value.media.find(row => row.role === 'candidate');
  const catalog = value.media.find(row => row.role === 'catalog');
  const entries = JSON.parse(await fs.readFile(catalog.path, 'utf8'));
  requireValue(Array.isArray(entries), '实际私人目录');
  const selected = entries.filter(row => object(row) && row.fileName === path.basename(candidate.path));
  requireValue(selected.length === 1 && selected[0].bytes === candidate.bytes &&
    selected[0].sha256 === candidate.sha256 && positive(selected[0].duration), '目录与实际候选内容身份');
  const validation = JSON.parse(await fingerprint(value.mediaValidation));
  requireValue(validation.status === 'LOCAL_MEDIA_VALIDATED' && object(validation.source) && object(validation.candidate) &&
    validation.source.beforeSHA256 === original.sha256 && validation.source.afterSHA256 === original.sha256 &&
    validation.source.bytes === original.bytes && validation.candidate.sha256 === candidate.sha256 &&
    validation.candidate.bytes === candidate.bytes && object(validation.exits) &&
    ['repaired-decode', 'transcode', 'candidate-decode'].every(key => validation.exits[key] === 0), '修复验证与最终媒体关联');
  requireValue(Array.isArray(value.checks) && value.checks.length === required.scenarios.length, '完整场景集合');
  for (const id of required.scenarios) {
    const rows = value.checks.filter(row => object(row) && row.id === id);
    requireValue(rows.length === 1 && rows[0].status === 'pass', `场景缺少/失败/重复 ${id}`);
    const report = JSON.parse(await fingerprint(rows[0].evidence));
    requireValue(object(report) && report.schema === 'private-recording-scenario/v1' &&
      report.scenario === id && report.status === 'pass', `场景 schema/status ${id}`);
    fresh(report.sources, sources);
    mediaEqual(report.media, value.media);
    requireValue(object(report.runtime) && text(report.runtime.engine) && text(report.runtime.version), `runtime ${id}`);
    if (id === 'ios-files-playback-and-offline') requireValue(report.runtime.engine === 'ios-simulator', 'iOS 目标环境');
    if (id === 'independent-coverage-code-architecture-review') requireValue(report.runtime.engine === 'native-reviewer', '原生独立审阅');
    requireValue(object(report.command) && Array.isArray(report.command.argv) && report.command.argv.length > 0 &&
      report.command.argv.every(text) && report.command.exitCode === 0, `实际命令 ${id}`);
    requireValue(Array.isArray(report.artifacts) && report.artifacts.length > 0, `场景制品 ${id}`);
    const kinds = new Set();
    for (const artifact of report.artifacts) {
      requireValue(object(artifact) && ['log', 'screenshot'].includes(artifact.kind), '制品种类');
      requireValue(path.resolve(artifact.path) !== path.resolve(rows[0].evidence.path), '场景报告不能充当原始日志');
      const bytes = await fingerprint(artifact);
      if (artifact.kind === 'screenshot') requireValue(bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), 'PNG 截图');
      kinds.add(artifact.kind);
    }
    requireValue(kinds.has('log') && (id === 'independent-coverage-code-architecture-review' || kinds.has('screenshot')), `日志/截图 ${id}`);
    observations(id, report.observations, candidate);
  }
  return { receipt: required.receipt, schema: value.schema, scenarios: required.scenarios };
}
