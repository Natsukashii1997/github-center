// 按 SKILL.md 约定识别仓库里的 Skill（#6）：一个目录里有文件名正好是 SKILL.md 的文件，
// 文件开头是 --- 包住的 YAML 头，里面写了 name 和 description。缺头、缺 name 或 description 的都不算。
const FILE = 'SKILL.md';

export const isSkillFile = (path) => path === FILE || path.endsWith(`/${FILE}`);
// Skill 的路径是 SKILL.md 所在的目录；仓库根目录本身是 Skill 时记为 "."。
const dirOf = (path) => path.slice(0, -FILE.length).replace(/\/$/, '') || '.';

// 只读顶层的 key: value，支持引号和 | > 多行写法；嵌套的字段用不到，跳过。
function frontmatter(yaml) {
  const out = {};
  const lines = yaml.split(/\r?\n/);
  const indented = (i) => i < lines.length && /^\s+\S/.test(lines[i]);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z_][\w-]*):(?:\s+(.*))?$/);
    if (!m) continue;
    let value = (m[2] ?? '').trim();
    const block = [];
    if (/^[|>][+-]?$/.test(value)) {
      while (indented(i + 1) || (i + 1 < lines.length && !lines[i + 1].trim() && indented(i + 2))) block.push(lines[++i].trim());
      value = block.join(value[0] === '|' ? '\n' : ' ');
    } else {
      while (indented(i + 1)) block.push(lines[++i].trim());
      value = [value.replace(/^(['"])(.*)\1$/, '$2'), ...block].filter(Boolean).join(' ');
    }
    out[m[1]] = value.trim();
  }
  return out;
}

// 是 Skill 就返回 { path, name, description }，不是返回 null。
export function parseSkill(path, text) {
  if (!isSkillFile(path)) return null;
  const m = text.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return null;
  const { name, description } = frontmatter(m[1]);
  return name && description ? { path: dirOf(path), name, description } : null;
}
