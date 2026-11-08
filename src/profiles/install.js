// 安装指令（#7）：按“整个项目或单个 Skill”和“Claude Code 或 Codex”生成一段交给 AI 的中文指令，复制给自己的 AI 去装。
// 中心不替项目编命令行：指令只给出处和规则，要求接收方 AI 依据项目文档装，查不到的步骤先读官方文档，仍查不到就停下来问；
// 缺账号、密钥或需要付费时停下来说明缺什么，不自行付费；装好后实际调用一次确认能用，最后说明用法。
import { currentGenerated } from './store.js';
import { skillPlace, skillPurpose } from './skills.js';

// 可以交给哪些 AI：显示名、放 Skill 的位置（工具自己的约定，不是项目文档写的）、它认的插件目录。
// Claude Code 的个人 Skill 目录是官方文档写明的；Codex 各版本说法不一，只让它查官方文档。
export const INSTALL_AIS = {
  'claude-code': { name: 'Claude Code', skillHome: 'Claude Code 的个人 Skill 放在 ~/.claude/skills/<Skill 名称>/ 目录里。', pluginDir: '.claude-plugin/' },
  codex: { name: 'Codex', skillHome: 'Codex 的 Skill 放在它会加载 Skill 的目录里；不同版本说法不一，先查你所用 Codex 版本的官方文档确认位置，再放进去。' },
};

const RULES = [
  '规则：',
  '1. 只依据项目文档和相关工具的官方文档做。文档里查不到的步骤，先去读官方文档；还是查不到就停下来告诉我，不要自己编命令。',
  '2. 需要账号、API Key、Token 或付费时，停下来告诉我缺什么、去哪里开通，等我处理；不要自己注册、付费，也不要编造或替我填写密钥。',
  '3. 要改动全局环境（全局安装、改环境变量或 shell 配置）之前，先告诉我要做什么。',
  '4. 最后告诉我：装在了哪里、怎么调用、最常用的一两个用法。',
];

const oneLine = (s) => s.replace(/\s+/g, ' ').trim();

// 中心整理到的使用条件（附原文摘录），以及哪些地方可能没整理全（条件核对不到被丢掉、文档只读了开头）。研究、试用交接也用（#79）。
export function usageNotes(m, g) {
  if (!g) return ['中心还没整理出这个项目的使用条件；装之前先看文档里有没有账号、密钥或付费要求。'];
  const notes = g.conditions.length
    ? ['中心从项目文档里整理到的使用条件（供参考，以文档为准）：', ...g.conditions.map((c) => `- ${c.kind}：${c.text}（原文：${oneLine(c.quote)}）`)]
    : ['中心在读到的项目文档里没有整理出账号、密钥或付费要求。'];
  if (g.droppedConditions) notes.push(`另有 ${g.droppedConditions} 条整理出的条件在原文里核对不到，没有列出。`);
  if (m.readme?.truncated || m.docs.some((d) => d.truncated)) notes.push('有的文档较长，中心只读了开头部分，后面可能还写了别的条件。');
  return notes;
}
const conditionNotes = (m, g) => [...usageNotes(m, g), ...(g ? ['装的过程中遇到账号、密钥或付费要求，照规则 2 停下来告诉我。'] : [])];

// profile 是存下的项目资料；skillPath 为空表示整个项目。
export function installInstruction({ profile, ai, skillPath }) {
  const m = profile.material;
  const g = currentGenerated(profile);
  const target = INSTALL_AIS[ai];
  const repoUrl = `https://github.com/${profile.fullName}`;
  const docs = [m.readme && `README（${m.readme.htmlUrl}）`, ...m.docs.map((d) => `${d.path}（${repoUrl}/blob/${profile.defaultBranch}/${d.path}）`)].filter(Boolean);
  const skill = skillPath ? m.skills.find((s) => s.path === skillPath) : null;
  const lines = [];
  if (skill) {
    const root = skill.path === '.';
    lines.push(
      `请在你所在的这台电脑上，把 GitHub 项目 ${profile.fullName} 里的 Skill「${skill.name}」装进 ${target.name}，装好后确认你能调用它，最后告诉我怎么用。`,
      '',
      root ? '要装的：这个仓库本身就是一个 Skill（SKILL.md 在仓库根目录）。' : '要装的：只装这一个 Skill，不装整个仓库。',
      `- Skill 名称：${skill.name}`,
      `- 用途：${oneLine(skillPurpose(skill, g))}`,
      `- 位置：${root ? repoUrl : `${repoUrl}/tree/${profile.defaultBranch}/${skill.path}`}（${root ? skillPlace(skill.path) : `${skill.path} 目录`}里的 SKILL.md 写明了它是什么、怎么用）`,
      ...(docs.length ? [`- 项目文档：${docs.join('、')}`] : []),
      '',
      '做法：',
      `- ${target.skillHome}${root ? '把仓库里 SKILL.md 和它用到的文件放进去（仓库自己的开发文件不用带）' : `把仓库里 ${skill.path} 这个目录完整放进去（SKILL.md 和同目录的其他文件，保持原有子目录）`}。项目文档对安装 Skill 另有说明的，按文档做。`,
      '- 同名的 Skill 已经存在时，先问我要不要覆盖。',
      '- 装好后确认它出现在你可用的 Skill 里，再按 SKILL.md 的说明实际调用一次；要重开会话才能生效的，告诉我去重开，重开后再一起确认。',
    );
  } else {
    lines.push(
      `请在你所在的这台电脑上，帮我安装并配置 GitHub 项目 ${profile.fullName}（${repoUrl}），装好后确认它能正常调用，最后告诉我怎么用。`,
      '',
      '要装的：整个项目。',
      '',
      '做法：',
      docs.length ? `- 先读项目文档：${docs.join('、')}，按文档里写的步骤安装和配置。` : `- 这个项目没有 README，先读仓库里的文件（${repoUrl}）弄清怎么装；弄不清就停下来告诉我。`,
      ...(target.pluginDir && m.listing.includes(target.pluginDir) ? [`- 仓库根目录有 ${target.pluginDir}，项目可能支持作为 ${target.name} 插件安装；文档里写了插件装法的，按文档做。`] : []),
      ...(m.skills.length ? [`- 仓库里有 ${m.skills.length} 个 Skill；文档没说要全部装上的，先问我要哪些。`] : []),
      '- 装好后实际调用一次（比如运行文档里给的示例或查看版本），把结果告诉我。',
    );
  }
  return [...lines, '', ...RULES, '', ...conditionNotes(m, g)].join('\n');
}
