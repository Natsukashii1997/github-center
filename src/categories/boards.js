// 按分类筛选榜单（#10）。分类只用来筛选，不改变榜单本身的客观排序（GLOSSARY“分类”）。
// 涨星榜：在这一期全部已核数的候选里按分类重新取前 20（含末位并列）。涨星低于完整性下限的照样列出、标出来
// （所有者 2026-10-23 决定），下限估计不了时全部标出；不足 20 个时如实给实际个数。
// 其他三个榜单在页面里榜内过滤（assets/boards.js），名次按过滤后的顺序重排。
import { topWithTies } from '../ranking/rank.js';

const inCategory = (find, category) => (x) => (find(x)?.categories ?? []).includes(category);

// candidates：readCandidates 读出的这一期候选；find：项目 → 分类记录（readCategories(...).get）。
// unclassified：还没归类、涨星又够得上这份名单的项目个数（名单不满 20 个时，没归类的都算）。
export function gainersInCategory({ candidates, find, category }) {
  const floor = candidates.check.completenessFloor;
  const positive = candidates.items.filter((x) => x.gain > 0);
  const entries = topWithTies(positive.filter(inCategory(find, category))).map((x) => ({ ...x, belowFloor: floor === null || x.gain < floor }));
  const cutoff = entries.length >= 20 ? entries.at(-1).gain : 1;
  const unclassified = positive.filter((x) => x.gain >= cutoff && !find(x)).length;
  return { category, floor, entries, unclassified };
}
