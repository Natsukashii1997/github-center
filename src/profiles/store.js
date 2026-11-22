// 项目资料按项目 id 各存一个文件（data/profiles/<id>.json），网站只读这里；记下生成依据（资料哈希、来源链接）。
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, writeAtomic } from '../store.js';

const profilesDir = (dataDir) => join(dataDir, 'profiles');
export const readProfile = (dataDir, id) => readJson(join(profilesDir(dataDir), `${id}.json`));
export const saveProfile = (dataDir, profile) => writeAtomic(join(profilesDir(dataDir), `${profile.projectId}.json`), JSON.stringify(profile, null, 2) + '\n');

// 和当前资料对得上的简介；资料更新后还没重新生成好（或从没生成过）就是 null。归类复核、使用条件和安装指令只用它（过期的条件会误导安装）。
export const currentGenerated = (profile) => (profile?.material && profile.generated?.materialHash === profile.material.hash ? profile.generated : null);
// 网站和周报显示的简介（#52）：资料更新后重新生成没成功，先用上一次的简介，不让看榜的人看到“生成中”；从没生成过是 null。
export const shownGenerated = (profile) => currentGenerated(profile) ?? profile?.generated ?? null;

// 按名字找（不分大小写），找不到返回 null。
export function findProfile(dataDir, fullName) {
  const dir = profilesDir(dataDir);
  if (!existsSync(dir)) return null;
  const key = fullName.toLowerCase();
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const p = readJson(join(dir, f));
    if (p.fullName.toLowerCase() === key) return p;
  }
  return null;
}

