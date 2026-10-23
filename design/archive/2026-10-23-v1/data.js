// 设计候选共用的示例数据：数字与简介是占位，不是真实统计。
window.GC = (() => {
  const CATS = ['AI 应用工具', 'Agent／MCP', '工作流自动化', '知识管理与办公效率', 'Skill', '开发框架与组件库', '数据库与数据工具', '开发者工具与基础设施', '其他'];
  const P = {};
  const add = (repo, total, what, problem, cats, extra = {}) => { P[repo] = { repo, total, what, problem, cats, conditions: [], skills: [], ...extra }; };
  add('morluto/rea', 241350, '辅助分析软件与程序运行逻辑的逆向工程工具集', '想弄清一个没有源码的程序在做什么时，让 AI 帮你反编译、追踪调用和解释行为', ['Agent／MCP', '开发者工具与基础设施'], { conditions: ['需要 macOS 或 Linux', '部分功能需要本机安装 Hopper 或 JEB'] });
  add('storytold/photocraft', 38210, '支持图层、蒙版与 PSD 的图片编辑器', '不想开 Photoshop 也能处理分层图片和蒙版', ['AI 应用工具']);
  add('Ebony-Vinyl/dsh-our-free-model', 21904, '为 dsh 添加模型接入功能', '让命令行助手 dsh 能接入你自己选的模型', ['开发者工具与基础设施'], { conditions: ['需要至少一个模型服务的 API Key'] });
  add('storytold/artcraft', 30115, '编排场景，制作 AI 图像和视频', '把分镜、角色和场景串起来，批量生成风格一致的画面', ['AI 应用工具']);
  add('boykopovar/AnyPS5', 18760, '辅助将 PS5 程序移植到电脑', '在电脑上运行原本只在主机上的程序', ['其他']);
  add('debpalash/VoiceStudio', 52640, '本地运行的 AI 声音工作室，集声音克隆、配音和语音生成于一体', '给视频配音、克隆自己的声音，而且数据不出本机', ['AI 应用工具'], { conditions: ['建议有 8GB 以上显存的显卡'] });
  add('storytold/wordcraft', 14420, '编辑 DOCX 文档，处理排版和修订', '让 AI 直接改 Word 文档并保留修订痕迹', ['知识管理与办公效率']);
  add('mattpocock/skills', 275300, '把软件工程方法做成一组 Agent Skills', '让你的 AI 按“先澄清需求、再拆任务、再测试驱动”的流程写代码', ['Skill'], {
    skills: [
      { name: 'grill-me', desc: '动手前连续追问，直到需求说清楚' },
      { name: 'to-spec', desc: '把对话整理成一份可执行的规格' },
      { name: 'tdd', desc: '先写失败的测试，再让它通过' },
      { name: 'diagnosing-bugs', desc: '按固定步骤定位难查的问题' },
    ],
  });
  add('cathrynlavery/diagram-design', 9120, '绘制流程图、架构图和信息图', '一句话描述就能得到一张排版干净的图', ['Skill', '知识管理与办公效率'], { skills: [{ name: 'diagram', desc: '生成流程图与架构图' }, { name: 'infographic', desc: '生成信息图' }] });
  add('NationalSecurityAgency/ghidra', 61200, '分析二进制程序的逆向工程工具', '研究恶意软件或没有源码的程序', ['开发者工具与基础设施'], { conditions: ['需要 Java 21 运行环境'] });
  add('vectorize-io/hindsight', 45100, '给 AI Agent 增加长期记忆', '让 AI 记住你过去说过的偏好和做过的事', ['Agent／MCP']);
  add('paperclipai/paperclip', 96800, '一个多 Agent 管理平台', '像管理团队一样给多个 AI 分工、派活、看进度', ['Agent／MCP', '工作流自动化']);
  add('stablyai/orca', 82400, '多 Coding Agent 并行管理工具', '同时让几个 AI 各写一部分代码而不互相打架', ['Agent／MCP']);
  add('openshell-dev/openshell', 14700, '为 AI Agent 设计的安全运行环境', '让 AI 执行命令时不会误删你的文件', ['开发者工具与基础设施']);
  add('dream-num/univer', 22300, '让 AI Agent 操作表格、文档、PPT、PDF', '让 AI 直接生成和修改办公文件', ['知识管理与办公效率']);
  add('anthropics/claude-plugins-official', 18900, 'Claude Code 官方插件与 Skill 目录', '一处找齐官方维护的 Claude Code 扩展', ['Skill'], { skills: [{ name: 'frontend-design', desc: '做出有设计感的前端界面' }, { name: 'pdf', desc: '读取、填写和生成 PDF' }, { name: 'xlsx', desc: '处理 Excel 表格' }] });
  add('Panniantong/Agent-Reach', 89800, '给 AI Agent 接入互联网', '让 AI 能搜索并读取多个平台上的内容', ['Agent／MCP']);
  add('example-org/ai-engineering-from-scratch-handbook', 63200, '从零开始构建 AI 工程的完整教程', '系统学会怎样做出自己的 AI 应用', ['其他']);
  add('a-very-long-organization-name/an-extremely-long-repository-name-to-test-wrapping', 3120, '一个专门用来测试最长中文简介显示效果的示例项目，简介写得特别长，用来检查换行、省略和对齐在各种宽度下是否依然优雅', '验证极端长度的名字与说明不会把版面撑坏', ['其他']);
  add('lumen-db/lumen', 7400, '嵌入式向量数据库', '在本机给几十万份文档做语义搜索', ['数据库与数据工具']);
  add('tinyui/tiny-ui', 5230, '只有 6KB 的无样式组件库', '快速搭出可访问的表单和弹窗', ['开发框架与组件库']);

  const order = {
    d1: [['morluto/rea', 31842], ['debpalash/VoiceStudio', 4210], ['storytold/photocraft', 3987], ['Ebony-Vinyl/dsh-our-free-model', 3120], ['storytold/artcraft', 2875], ['mattpocock/skills', 2510], ['boykopovar/AnyPS5', 2302], ['vectorize-io/hindsight', 2140], ['storytold/wordcraft', 1988], ['cathrynlavery/diagram-design', 1870], ['NationalSecurityAgency/ghidra', 1702], ['paperclipai/paperclip', 1655], ['stablyai/orca', 1530], ['Panniantong/Agent-Reach', 1420], ['openshell-dev/openshell', 1388], ['dream-num/univer', 1276], ['anthropics/claude-plugins-official', 1201], ['example-org/ai-engineering-from-scratch-handbook', 1150], ['a-very-long-organization-name/an-extremely-long-repository-name-to-test-wrapping', 1088], ['lumen-db/lumen', 1034], ['tinyui/tiny-ui', 1034]],
    d7: [['morluto/rea', 223708], ['storytold/photocraft', 21066], ['Ebony-Vinyl/dsh-our-free-model', 15837], ['storytold/artcraft', 15581], ['boykopovar/AnyPS5', 13599], ['debpalash/VoiceStudio', 13474], ['storytold/wordcraft', 10676], ['mattpocock/skills', 10131], ['cathrynlavery/diagram-design', 7613], ['NationalSecurityAgency/ghidra', 7502], ['vectorize-io/hindsight', 7120], ['paperclipai/paperclip', 6890], ['Panniantong/Agent-Reach', 6402], ['stablyai/orca', 6011], ['dream-num/univer', 5320], ['openshell-dev/openshell', 5102], ['example-org/ai-engineering-from-scratch-handbook', 5099], ['anthropics/claude-plugins-official', 4870], ['lumen-db/lumen', 4410], ['tinyui/tiny-ui', 4205]],
    d30: [['morluto/rea', 241002], ['paperclipai/paperclip', 41870], ['debpalash/VoiceStudio', 40112], ['stablyai/orca', 35660], ['storytold/photocraft', 33320], ['vectorize-io/hindsight', 31014], ['Panniantong/Agent-Reach', 29870], ['storytold/artcraft', 27200], ['mattpocock/skills', 25560], ['NationalSecurityAgency/ghidra', 21980], ['Ebony-Vinyl/dsh-our-free-model', 20117], ['example-org/ai-engineering-from-scratch-handbook', 19830], ['boykopovar/AnyPS5', 17940], ['dream-num/univer', 15730], ['storytold/wordcraft', 13560], ['anthropics/claude-plugins-official', 12840], ['openshell-dev/openshell', 11950], ['cathrynlavery/diagram-design', 8870], ['lumen-db/lumen', 6930], ['tinyui/tiny-ui', 5120]],
  };
  const FLOOR = { d1: 1034, d7: 4205, d30: 5120 };
  const WINDOWS = [['d1', '近 1 天'], ['d7', '近 7 天'], ['d30', '近 30 天']];

  // 名次：并列同名次；分类筛选在同一份已核数结果里重排，不足 20 个如实显示。
  function ranking(win, cat) {
    const rows = order[win].map(([repo, gain]) => ({ ...P[repo], gain })).filter((r) => !cat || r.cats.includes(cat));
    let last = null, rank = 0;
    return rows.slice(0, 20 + rows.slice(20).filter((r) => rows[19] && r.gain === rows[19].gain).length).map((r, i) => {
      if (r.gain !== last) rank = i + 1;
      last = r.gain;
      return { ...r, rank, tie: rows.filter((x) => x.gain === r.gain).length > 1 };
    });
  }

  function installText(repo, target, skill) {
    const who = target === 'claude' ? 'Claude Code' : 'Codex';
    const what = skill ? `仓库 ${repo} 里名为「${skill}」的 Skill` : `GitHub 项目 ${repo}`;
    return `请在你所在的这台电脑上，为 ${who} 安装${what}（https://github.com/${repo}）。\n1. 先阅读项目官方 README 和安装文档，按文档步骤安装和配置，不要猜测命令。\n2. 装好后实际调用一次，确认能正常使用。\n3. 如果需要账号、API Key 或付费，停下来告诉我缺什么，不要自行注册或付费。\n4. 最后用两三句话告诉我：它装在哪里、怎么调用、第一次可以怎么试。`;
  }

  const fmt = (n) => n.toLocaleString('en-US');
  const short = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(n));
  const vtName = (repo) => 'r-' + repo.replace(/[^a-zA-Z0-9]/g, '-');
  const meta = { statDay: '2026-10-22', updatedAt: '2026-10-23 10:04', lastGood: '2026-10-21' };

  // 收藏与演示状态（仅在本页内存中，候选阶段不持久化）。
  const favs = new Set(['mattpocock/skills']);
  const toggleFav = (key) => (favs.has(key) ? (favs.delete(key), false) : (favs.add(key), true));

  // 换页时尽量用浏览器原生过渡；不支持或用户要求减少动态效果时直接更新。
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const transition = (fn) => (document.startViewTransition && !reduced() ? document.startViewTransition(fn) : (fn(), null));

  // 设计演示面板：切换各种状态，供评审查看。
  function demoPanel(onChange) {
    const states = [['normal', '正常'], ['incomplete', '可能不完整'], ['failed', '更新失败'], ['generating', '简介生成中']];
    const el = document.createElement('div');
    el.className = 'gc-demo';
    el.innerHTML = '<b>设计演示 · 示例数据</b>' + states.map(([k, l]) => `<button data-state="${k}">${l}</button>`).join('');
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      onChange(b.dataset.state);
    });
    el.querySelector('button').classList.add('on');
    const style = document.createElement('style');
    style.textContent = '.gc-demo{position:fixed;left:16px;bottom:16px;z-index:999;display:flex;gap:6px;align-items:center;padding:8px 10px;border-radius:10px;background:rgba(20,20,20,.86);color:#eee;font:12px/1.2 -apple-system,"PingFang SC",sans-serif;backdrop-filter:blur(8px)}.gc-demo b{font-weight:600;margin-right:4px;opacity:.7}.gc-demo button{all:unset;cursor:pointer;padding:5px 8px;border-radius:6px;opacity:.75}.gc-demo button.on{background:#fff;color:#111;opacity:1}';
    document.head.append(style);
    document.body.append(el);
  }

  const REDUCED_CSS = '@media (prefers-reduced-motion: reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:.01ms!important;transition-delay:0s!important}}';
  const style = document.createElement('style');
  style.textContent = REDUCED_CSS;
  document.head.append(style);

  return { CATS, P, WINDOWS, FLOOR, ranking, installText, fmt, short, vtName, meta, favs, toggleFav, transition, reduced, demoPanel };
})();
