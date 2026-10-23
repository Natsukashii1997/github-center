// 项目资料按项目 id 各存一个文件（data/profiles/<id>.json），网站只读这里；记下生成依据（资料哈希、来源链接）。
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, writeAtomic, readLatestSnapshot } from '../ranking/store.js';
import { WINDOWS } from '../ranking/stat-day.js';
import { SINCES } from '../ranking/lists.js';

const profilesDir = (dataDir) => join(dataDir, 'profiles');
export const readProfile = (dataDir, id) => readJson(join(profilesDir(dataDir), `${id}.json`));
export const saveProfile = (dataDir, profile) => writeAtomic(join(profilesDir(dataDir), `${profile.projectId}.json`), JSON.stringify(profile, null, 2) + '\n');

// 和当前资料对得上的简介；资料更新后还没重新生成好（或从没生成过）就是 null，页面和安装指令都不用过期的内容。
export const currentGenerated = (profile) => (profile?.material && profile.generated?.materialHash === profile.material.hash ? profile.generated : null);

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

// 网站上各榜单当前显示的项目（每个榜前 20 含并列；官方热门榜每页前 20），去重；近 1 天涨星榜排最前，先生成。
export function boardProjects(dataDir) {
  const seen = new Set();
  const out = [];
  const add = (e) => {
    const keys = [`name:${e.fullName.toLowerCase()}`, ...(e.projectId ? [`id:${e.projectId}`] : [])];
    if (keys.some((k) => seen.has(k))) return;
    keys.forEach((k) => seen.add(k));
    out.push({ id: e.projectId ?? null, name: e.fullName });
  };
  const trending = readLatestSnapshot(dataDir, 'trending');
  const pages = (sinces) => sinces.flatMap((s) => trending?.pages[s]?.entries.slice(0, 20) ?? []);
  for (const w of Object.keys(WINDOWS)) readLatestSnapshot(dataDir, w)?.entries.forEach(add);
  pages(SINCES.slice(0, 1)).forEach(add);
  for (const l of ['new', 'top']) readLatestSnapshot(dataDir, l)?.entries.forEach(add);
  pages(SINCES.slice(1)).forEach(add);
  return out;
}

// 榜单上的这个项目（按名字不分大小写，或按项目 id），不在榜单上返回 undefined。
export const findOnBoards = (dataDir, { name, id }) => boardProjects(dataDir).find((p) => (id ? p.id === id : p.name.toLowerCase() === name.toLowerCase()));
