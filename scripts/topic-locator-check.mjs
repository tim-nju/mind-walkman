import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const appSource = await fs.readFile('app.js', 'utf8');

class MockStorage {
  constructor() { this.store = new Map(); }
  getItem(k) { return this.store.has(k) ? this.store.get(k) : null; }
  setItem(k, v) { this.store.set(k, String(v)); }
  removeItem(k) { this.store.delete(k); }
  clear() { this.store.clear(); }
}

const mockLocalStorage = new MockStorage();
const mockElements = new Map();

function createMockElement(tag = 'div') {
  return {
    tagName: tag.toUpperCase(),
    textContent: '',
    value: '',
    disabled: false,
    hidden: false,
    children: [],
    dataset: {},
    replaceChildren(...items) { this.children = items; },
    append(...items) { this.children.push(...items); },
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    classList: {
      add() {},
      remove() {},
      contains() { return false; }
    },
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    scrollIntoView() {},
    pause() {},
    load() {},
    play() { return Promise.resolve(); }
  };
}

function mockElement(id) {
  if (!mockElements.has(id)) {
    mockElements.set(id, createMockElement('element-' + id));
  }
  return mockElements.get(id);
}

const dummyTopic = {
  id: 'test-topic',
  title: '测试专题',
  speaker: '测试讲师',
  tracks: [
    { id: 'test-001', title: '第1集', duration: 100, speaker: '测试讲师' },
    { id: 'test-002', title: '第2集', duration: 200, speaker: '测试讲师' },
    { id: 'test-003', title: '第3集', duration: 300, speaker: '测试讲师' },
    { id: 'test-004', title: '第4集', duration: 400, speaker: '测试讲师' }
  ]
};

const sandbox = {
  document: {
    getElementById: mockElement,
    querySelector: () => mockElement('dummy'),
    querySelectorAll: () => [],
    createElement: tag => createMockElement(tag),
    addEventListener: () => {}
  },
  window: { addEventListener: () => {} },
  localStorage: mockLocalStorage,
  location: { hostname: 'localhost' },
  navigator: { onLine: true },
  AudioStore: { keys: async () => [], get: async () => null },
  ORIGINAL_TRACK: dummyTopic.tracks[0],
  COURSE_TOPIC: dummyTopic,
  HOPE_TOPIC: { id: 'hope-topic', title: 'Hope', tracks: [{ id: 'hope-01', duration: 50 }] },
  readPrivateCatalog: () => [],
  importController: null,
  privateCatalogStatus: () => {},
  setupControls: () => {},
  setupImporter: () => {},
  renderChapters: () => {},
  clearAB: () => {},
  updateProgressUI: () => {},
  setupMediaSession: () => {},
  resetImportSelection: () => {},
  setInterval: () => {},
  setTimeout: (fn) => setTimeout(fn, 1800),
  clearTimeout: () => {},
  requestAnimationFrame: fn => fn(),
  Option: class { constructor(text, value) { this.text = text; this.value = value; } },
  URL: { createObjectURL: () => 'blob:', revokeObjectURL: () => {} },
  globalThis: {}
};
sandbox.globalThis = sandbox;

// Run script in sandbox
vm.createContext(sandbox);
vm.runInContext(appSource, sandbox);

console.log('--- Testing findActiveTrack scenarios ---');

// Scenario 1: Default to track 0 when no history exists
mockLocalStorage.clear();
const initialTrack = sandbox.findActiveTrack(dummyTopic);
assert.equal(initialTrack.id, 'test-001', 'Should default to track 0');
console.log('PASS: Defaults to track 0 on fresh topic');

// Scenario 2: Per-topic memory takes highest precedence
mockLocalStorage.clear();
mockLocalStorage.setItem('mw_lastTrack_test-topic', 'test-003');
mockLocalStorage.setItem('mw_lastTrack', 'test-002');
const topicMemoryTrack = sandbox.findActiveTrack(dummyTopic);
assert.equal(topicMemoryTrack.id, 'test-003', 'Per-topic memory mw_lastTrack_test-topic should win');
console.log('PASS: Per-topic memory mw_lastTrack_<topicId> takes precedence');

// Scenario 3: Global lastTrack used when matching topic and no per-topic memory
mockLocalStorage.clear();
mockLocalStorage.setItem('mw_lastTrack', 'test-002');
const globalMemoryTrack = sandbox.findActiveTrack(dummyTopic);
assert.equal(globalMemoryTrack.id, 'test-002', 'Global lastTrack should be used when in topic');
console.log('PASS: Global lastTrack used when matching topic');

// Scenario 4: In-progress track (savedPosition > 0, completed: false) auto-discovered
mockLocalStorage.clear();
mockLocalStorage.setItem('mw_pos_test-003', '125');
mockLocalStorage.setItem('mw_progress_test-003', JSON.stringify({ completed: false, furthest: 125, duration: 300 }));
const inProgressTrack = sandbox.findActiveTrack(dummyTopic);
assert.equal(inProgressTrack.id, 'test-003', 'In-progress track should be identified');
console.log('PASS: In-progress track auto-discovered');

// Scenario 5: When prior tracks are completed, advance to next uncompleted track
mockLocalStorage.clear();
mockLocalStorage.setItem('mw_progress_test-001', JSON.stringify({ completed: true, furthest: 100, duration: 100 }));
mockLocalStorage.setItem('mw_progress_test-002', JSON.stringify({ completed: true, furthest: 200, duration: 200 }));
const nextUncompleted = sandbox.findActiveTrack(dummyTopic);
assert.equal(nextUncompleted.id, 'test-003', 'Should locate track 3 when tracks 1 and 2 are completed');
console.log('PASS: Sequential completion advances to next uncompleted track');

// Scenario 6: When all tracks completed, locate last track
mockLocalStorage.setItem('mw_progress_test-003', JSON.stringify({ completed: true, furthest: 300, duration: 300 }));
mockLocalStorage.setItem('mw_progress_test-004', JSON.stringify({ completed: true, furthest: 400, duration: 400 }));
const allCompletedTrack = sandbox.findActiveTrack(dummyTopic);
assert.equal(allCompletedTrack.id, 'test-004', 'Should locate last track when all completed');
console.log('PASS: All completed locates last track');

// Scenario 7: selectTrack updates both mw_lastTrack and mw_lastTrack_<topicId>
mockLocalStorage.clear();
await sandbox.selectTrack(dummyTopic.tracks[2], false, true);
assert.equal(mockLocalStorage.getItem('mw_lastTrack'), 'test-003', 'mw_lastTrack should be updated');
assert.equal(mockLocalStorage.getItem('mw_lastTrack_test-topic'), 'test-003', 'mw_lastTrack_test-topic should be updated');
console.log('PASS: selectTrack persists both global and per-topic lastTrack');

// Scenario 8: scrollToActiveTrack locates aria-current="true" row and triggers animation
let scrolled = false;
let scrollOptions = null;
let pulseAdded = false;
const mockRow = {
  scrollIntoView(options) { scrolled = true; scrollOptions = options; },
  classList: {
    add(cls) { if (cls === 'track-row-locate-pulse') pulseAdded = true; },
    remove() {}
  },
  offsetWidth: 100
};
mockElements.get('trackList').querySelector = selector => selector === '[aria-current="true"]' ? mockRow : null;
sandbox.scrollToActiveTrack({ behavior: 'smooth', block: 'center', flash: true });
assert.equal(scrolled, true, 'Row should be scrolled');
assert.equal(scrollOptions.behavior, 'smooth', 'behavior should be smooth');
assert.equal(scrollOptions.block, 'center', 'block should be center');
assert.equal(pulseAdded, true, 'Pulse animation class should be added');
console.log('PASS: scrollToActiveTrack scrolls active row with smooth/center options and pulse animation');

console.log('ALL TOPIC LOCATOR UNIT CHECKS PASSED!');
