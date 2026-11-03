// Github·Tidings · #14 那套共用组件，2026-11-03 白雾重设计后只剩登录页在用（首页、项目页、我的收藏改用 bw.js，#21、#22）：
// 取元素、图标、动效。收藏、复制安装指令、提示气泡等随我的收藏改版一并删掉。
window.GC = (() => {
  const I = window.ICONS;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // ── 动效 ──
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const EASE = 'cubic-bezier(.25, 1, .5, 1)';
  const anim = (el, kf, o) => (reduced() || !el ? null : el.animate(kf, { easing: EASE, ...o }));

  return { I, $, $$, anim };
})();
