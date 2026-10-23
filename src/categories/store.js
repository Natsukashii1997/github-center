// 项目分类（#10）存在 data/categories.json：按项目 id 一条（没有 id 的按小写名字），记下分类、依据和归类时间。
// 依据 batch：名称、描述和 topics；review：项目页完整资料（记下资料哈希，资料变了再复核）。网站只读这里。
import { join } from 'node:path';
import { readJson, writeAtomic } from '../ranking/store.js';

// 固定清单（#10、GLOSSARY“分类”），顺序即页面上分类胶囊的顺序。
export const CATEGORIES = ['AI 应用工具', 'Agent／MCP', '工作流自动化', '知识管理与办公效率', 'Skill', '开发框架与组件库', '数据库与数据工具', '开发者工具与基础设施', '其他'];
export const MAX_CATEGORIES = 2;

const filePath = (dataDir) => join(dataDir, 'categories.json');
export const categoryKey = ({ id, fullName }) => (id ? String(id) : `name:${fullName.toLowerCase()}`);

// 查某个项目的分类：先按 id 找，再按名字找（归类时还不知道 id 的记录按名字存）。items 改过后要重新建。
export function lookup(items) {
  const byName = new Map(Object.values(items).map((r) => [r.fullName.toLowerCase(), r]));
  return ({ id, fullName }) => (id && items[String(id)]) || byName.get(fullName.toLowerCase()) || null;
}

export function readCategories(dataDir) {
  const items = readJson(filePath(dataDir))?.items ?? {};
  return { items, get: lookup(items) };
}

export const saveCategories = (dataDir, items) => writeAtomic(filePath(dataDir), JSON.stringify({ items }) + '\n');

// 只认清单里的分类，去重，最多 2 个；一个都不剩就是空数组（算没归上类，下次再归）。
export const pickCategories = (raw) => [...new Set((Array.isArray(raw) ? raw : []).filter((c) => CATEGORIES.includes(c)))].slice(0, MAX_CATEGORIES);
