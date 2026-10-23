// 安装指令（#7）：按“整个项目或单个 Skill”和“Claude Code 或 Codex”生成一段交给 AI 的中文指令，复制给自己的 AI 去装。
// 中心不替项目编安装命令：指令只给出处和规则，要求接收方 AI 依据项目文档装，查不到的步骤先读官方文档，仍查不到就停下来问；
// 缺账号、密钥或需要付费时停下来说明缺什么，不自行付费；装好后实际调用一次确认能用，最后说明用法。
export const AIS = { 'claude-code': 'Claude Code', codex: 'Codex' };

// 各 AI 放 Skill 的位置是工具自己的约定，不是项目文档写的；Codex 各版本说法不一，让 AI 以官方文档为准。
const SKILL_HOME = {
  'claude-code': 'Claude Code 的个人 Skill 放在 ~/.claude/skills/<Skill 名称>/ 目录里。',
  codex: 'Codex 的 Skill 放在它会加载 Skill 的目录里（常见的是 ~/.codex/skills/<Skill 名称>/），以你所用 Codex 版本的官方文档为准。',
};

const RULES = [
  '规则：',
  '1. 只依据项目文档和相关工具的官方文档做。文档里查不到的步骤，先去读官方文档；还是查不到就停下来告诉我，不要自己编命令。',
  '2. 需要账号、API Key、Token 或付费时，停下来告诉我缺什么、去哪里开通，等我处理；不要自己注册、付费，也不要编造或替我填写密钥。',
  '3. 要改动全局环境（全局安装、改环境变量或 shell 配置）之前，先告诉我要做什么。',
  '4. 最后告诉我：装在了哪里、怎么调用、最常用的一两个用法。',
];

const oneLine = (s) => s.replace(/\s+/g, ' ').trim();

// profile 是存下的项目资料；generated 是和当前资料对得上的简介（没有就传 null）；skillPath 为空表示整个项目。
export function installInstruction({ profile, generated, ai, skillPath }) {
  const m = profile.material;
  const repoUrl = `https://github.com/${profile.fullName}`;
  const skill = skillPath ? m.skills.find((s) => s.path === skillPath) : null;
  const lines = [];
  if (skill) {
    const where = skill.path === '.' ? '仓库根目录' : skill.path;
    const dirUrl = skill.path === '.' ? repoUrl : `${repoUrl}/tree/${profile.defaultBranch}/${skill.path}`;
    lines.push(
      `请在你所在的这台电脑上，把 GitHub 项目 ${profile.fullName} 里的 Skill「${skill.name}」装进 ${AIS[ai]}，装好后确认你能调用它，最后告诉我怎么用。`,
      '',
      '要装的：只装这一个 Skill，不装整个仓库。',
      `- Skill 名称：${skill.name}`,
      `- 用途：${oneLine(generated?.skillPurposes[skill.path] ?? skill.description)}`,
      `- 位置：${dirUrl}（${where} 下的 SKILL.md 写明了它是什么、怎么用）`,
      '',
      '做法：',
      `- ${SKILL_HOME[ai]}把仓库里 ${where} 这个目录完整放进去（SKILL.md 和同目录的其他文件，保持原有子目录）。项目文档对安装 Skill 另有说明的，按文档做。`,
      '- 同名的 Skill 已经存在时，先问我要不要覆盖。',
      '- 装好后确认它出现在你可用的 Skill 里（必要时新开一次会话），再按 SKILL.md 的说明实际调用一次。',
    );
  } else {
    const docs = [m.readme && `README（${m.readme.htmlUrl}）`, ...m.docs.map((d) => `${d.path}（${repoUrl}/blob/${profile.defaultBranch}/${d.path}）`)].filter(Boolean);
    lines.push(
      `请在你所在的这台电脑上，帮我安装并配置 GitHub 项目 ${profile.fullName}（${repoUrl}），装好后确认它能正常调用，最后告诉我怎么用。`,
      '',
      '要装的：整个项目。',
      '',
      '做法：',
      docs.length ? `- 先读项目文档：${docs.join('、')}，按文档里写的步骤安装和配置。` : `- 这个项目没有 README，先读仓库里的文件（${repoUrl}）弄清怎么装；弄不清就停下来告诉我。`,
      ...(ai === 'claude-code' && m.listing.includes('.claude-plugin/') ? ['- 仓库根目录有 .claude-plugin/，项目可能支持作为 Claude Code 插件安装；文档里写了插件装法的，按文档做。'] : []),
      ...(m.skills.length ? [`- 仓库里有 ${m.skills.length} 个 Skill；文档没说要全部装上的，先问我要哪些。`] : []),
      '- 装好后实际调用一次（比如运行文档里给的示例或查看版本），把结果告诉我。',
    );
  }
  lines.push('', ...RULES, '');
  if (!generated) lines.push('中心还没整理出这个项目的使用条件；装之前先看文档里有没有账号、密钥或付费要求。');
  else if (generated.conditions.length) lines.push('中心从项目文档里整理到的使用条件（供参考，以文档为准）：', ...generated.conditions.map((c) => `- ${c.kind}：${c.text}（原文：${oneLine(c.quote)}）`));
  else lines.push('中心在读到的项目文档里没有找到账号、密钥或付费要求；装的过程中遇到了，照规则 2 停下来告诉我。');
  return lines.join('\n');
}
