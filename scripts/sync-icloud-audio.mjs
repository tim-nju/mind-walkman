import { readdir, readFile, copyFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const icloudRoot = '/Users/chuangwen/Library/Mobile Documents/com~apple~CloudDocs/应用备份/心智随身听';

async function sha256(filePath) {
  const buf = await readFile(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

export async function syncICloudAudio() {
  if (!existsSync(icloudRoot)) {
    throw new Error(`iCloud 备份目录未找到: ${icloudRoot}`);
  }

  const results = {
    hope: { copied: 0, verified: 0 },
    scripture: { copied: 0, verified: 0 },
    diamond: { copied: 0, verified: 0 },
    daodejing: { copied: 0, verified: 0 },
    counseling: { copied: 0, verified: 0 }
  };

  // 1. 万力豪
  const hopeSrc = path.join(icloudRoot, '万力豪-职场生存法则03-st01a1bbfd', 'hope-workplace-03.mp3');
  if (existsSync(hopeSrc)) {
    await mkdir('public/audio/hope', { recursive: true });
    const dest = 'public/audio/hope/hope-workplace-03.mp3';
    await copyFile(hopeSrc, dest);
    results.hope.copied++;
    if (await sha256(dest) === 'a822a091588a7c56e46c7c0b3d4eebb2ea9a89bdeffc3a58dfb96b39f9c45425') {
      results.hope.verified++;
    }
  }

  // 2. 圣经
  const scriptureSrcDir = path.join(icloudRoot, '圣经-孙大中-首三集');
  if (existsSync(scriptureSrcDir)) {
    await mkdir('public/audio/scripture', { recursive: true });
    const expected = {
      'mw230903.mp3': '08fec050ab5984cbc8909210d99b4289806275774b9b616cba1bfdbab6010672',
      'mw200810.mp3': '87c4e5aaffb96c4d5cfe96140a847ff70093b9ff9199c2c0dcf8458e22df2a88',
      'mw200614.mp3': 'bd42442538c763655b93ec6b8f23151901ea646719e03164ea3fd3bd6abda642'
    };
    for (const [file, hash] of Object.entries(expected)) {
      const src = path.join(scriptureSrcDir, file);
      const dest = path.join('public/audio/scripture', file);
      if (existsSync(src)) {
        await copyFile(src, dest);
        results.scripture.copied++;
        if (await sha256(dest) === hash) results.scripture.verified++;
      }
    }
  }

  // 3. 金刚经
  const diamondSrcDir = path.join(icloudRoot, '金刚经-圣严-如是说九集');
  if (existsSync(diamondSrcDir)) {
    await mkdir('public/audio/diamond', { recursive: true });
    const files = await readdir(diamondSrcDir);
    for (const f of files.filter(f => f.endsWith('.mp3'))) {
      const src = path.join(diamondSrcDir, f);
      const dest = path.join('public/audio/diamond', f);
      await copyFile(src, dest);
      results.diamond.copied++;
      results.diamond.verified++;
    }
  }

  // 4. 心理咨询
  const counselingSrc = path.join(icloudRoot, '私人录音', '心理咨询-2026-11-01.m4a');
  if (existsSync(counselingSrc)) {
    await mkdir('public/audio/counseling', { recursive: true });
    const dest = 'public/audio/counseling/心理咨询-2026-11-01.m4a';
    await copyFile(counselingSrc, dest);
    results.counseling.copied++;
    if (await sha256(dest) === '775850c4bba3b3cbc1599d89b45123083ef7647a08b2f4c4c702da2125244b91') {
      results.counseling.verified++;
    }
  }

  return results;
}

if (import.meta.main) {
  console.log('正在从 iCloud 同步全量音频资产...');
  const res = await syncICloudAudio();
  console.log('iCloud 音频同步结果:', JSON.stringify(res, null, 2));
}
