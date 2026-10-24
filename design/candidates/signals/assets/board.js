// 样稿 signals-r1（#16）组件板：用和页面同一套组件函数（gc.js）画出全部状态。项目资料是真实的，名次变化、期数、版本是示例。
(() => {
  const { $, D, esc, num } = GC;
  GC.topbar('');
  GC.setStatus({ tone: 'ok', text: '组件板 · 样稿 signals-r1' });
  const run = D.run;
  const row = (repo, rank, o = {}) => ({ repo, rank, tie: false, gain: 1000, run, ...o });
  const draw = (rowsEl, markEl, rows, sel) => {
    rowsEl.innerHTML = '';
    for (const r of rows) { const li = GC.rowCreate(r, () => {}); li.dataset.key = r.repo + r.rank; GC.rowUpdate(li, r); rowsEl.appendChild(li); }
    if (sel) GC.placeSel(rowsEl, markEl, sel);
  };

  // 榜单行：四种记号，含并列
  draw($('#rows1'), $('#mark1'), [
    row('morluto/rea', 1, { gain: 5316, mv: { kind: 'flat' } }),
    row('peach-mitao/peach', 2, { gain: 4236, mv: { kind: 'up', n: 1 } }),
    row('Gathin23/cleanyourtv', 3, { gain: 2813, mv: { kind: 'down', n: 1 } }),
    row('debpalash/VoiceStudio', 4, { gain: 1380, tie: true, mv: { kind: 'up', n: 12 } }),
    row('xerj-org/xerj', 4, { gain: 1380, tie: true, mv: { kind: 'new' } }),
    row('YuJunZhiXue/dsh-purge', 7, { gain: 1038, mv: { kind: 'new' } }),
    row('Graphify-Labs/graphify', 20, { gain: 612, mv: { kind: 'down', n: 10 } }),
  ], 'morluto/rea1');

  // 没有上一期
  const NO_PREV = { icon: 'calendar', title: '没有上一期', text: '暂不显示名次变化。' };
  GC.notes($('#notes2'), [NO_PREV]);
  draw($('#rows2'), $('#mark2'), [row('morluto/rea', 1, { gain: 79414 }), row('Gathin23/cleanyourtv', 2, { gain: 28137 }), row('peach-mitao/peach', 12, { gain: 9120 })]);
  GC.notes($('#notes3'), [{ tone: 'warn', icon: 'warn', title: '可能有漏', text: '第 14 名起涨星低于完整性下限 +260：涨星比下限少的项目，事件数据可能没记到，名单可能不全。' }, NO_PREV]);

  // 阅读卡顶行
  const eb = (rank, tie, label, streak, gain, ex) => `<div class="eyebrow"><span>第 ${rank} 名${tie ? '（并列）' : ''} · ${label}</span>${streak ? `<span class="streak">${streak}</span>` : ''}<span class="num">+${num(gain)}</span>${ex ? '<span class="ex">示例</span>' : ''}</div>`;
  $('#eyebrows').innerHTML = [
    eb(1, false, '近 1 天', '连续 2 期第 1', 5316, false),
    eb(1, false, '近 7 天', '连续 6 期第 1', 79414, true),
    eb(4, true, '近 1 天', '连续 4 期前 20', 1380, true),
    eb(7, false, '近 1 天', null, 1038, false),
  ].join('') + '<span class="cap">第 4 行：只上了一期，或上一期缺，不写期数。</span>';

  // 项目页名次胶囊
  const pill = (label, rank, tie, mv, streak) => `<span class="rank-grp"><span class="rank-pill"><span>${label}第 ${rank} 名${tie ? '（并列）' : ''}</span>${GC.mvHTML(mv, true)}</span>${streak ? `<span class="streak">${streak}</span>` : ''}</span>`;
  $('#ranks').innerHTML = `<div class="ranks">${pill('近 1 天', 1, false, { kind: 'flat' }, '连续 2 期第 1')}${pill('近 7 天', 1, false, null)}${pill('近 30 天', 1, false, null)}</div><span class="cap">morluto/rea 现在的样子（近 7/30 天还没有可比的上一期）。</span>
    <div class="ranks">${pill('近 1 天', 3, false, { kind: 'up', n: 2 }, '连续 3 期前 20')}${pill('近 7 天', 9, false, { kind: 'down', n: 4 }, '连续 5 期前 20')}${pill('近 30 天', 15, false, { kind: 'new' })}</div><span class="cap">示例：升、降、新进，各带或不带期数。</span>
    <div class="ranks">${pill('近 1 天', 4, true, { kind: 'up', n: 12 }, '连续 2 期前 20')}</div><span class="cap">示例：并列和名次变化同在一个胶囊里。</span>
    <div class="ranks"><span>不在当前三个涨星榜的前 20 名里</span></div><span class="cap">不在榜上：沿用现有写法，不加记号。</span>`;

  // 维护信号
  const p = D.projects['morluto/rea'];
  const title = (maint, cap) => `<div class="title"><img class="av" alt="" referrerpolicy="no-referrer" src="${GC.avatar(p, 112)}"><div><h2><span class="o">${esc(GC.ownerOf(p))}/</span>${esc(GC.nameOf(p))}</h2><div class="meta">${p.cats.map((c) => `<span>${esc(c)}</span>`).join('')}<span>${esc(p.lang)}</span><span>创建于 4 月 14 日</span></div><div class="meta maint">${maint}</div><span class="cap">${cap}</span></div></div>`;
  $('#maint').innerHTML = [
    title('<span>最近推送 10 月 24 日</span><span>最新版本 <a href="https://github.com/morluto/rea/releases/tag/rea-agents-6.7.0" target="_blank" rel="noopener"><code>rea-agents-6.7.0</code></a>（10 月 18 日）</span>', '有正式版（真实数据）。'),
    title('<span>最近推送 10 月 24 日</span><span>还没发过正式版</span>', '没发过正式版，或只发过预发布（GitHub 的“最新正式版”接口不算预发布）。真实例子：peach-mitao/peach。'),
    title('<span>最近推送 未知</span><span>最新版本 未知</span>', '查不到：资料里没有推送时间、接口失败或限流。两项各自判断，可能只有一项是“未知”。'),
  ].join('');

  // 日报概览
  $('#ov').innerHTML = `<p class="overview-wide">${esc(D.overview)}</p><span class="cap">10 月 23 日日报（真实数据）：只有近 1 天有可比的上一期，所以只说近 1 天。</span>
    <p class="overview-wide">……10 个项目在所在时间窗口内发了正式版本。近 1 天前 10 里有 3 个上一期不在前 10，morluto/rea 连续 3 期第 1；近 7 天前 10 里有 1 个上一期不在前 10，morluto/rea 连续 2 期第 1；近 30 天前 10 里有 2 个上一期不在前 10。</p><span class="cap">示例：10 月 24 日起三个窗口都有上一期；没人连续第 1 的窗口只说个数。</span>`;
})();
