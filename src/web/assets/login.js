// 登录页（#14，照冻结方案 t1b-pages-r1 的 design/t1b-pages/login.html）：表单由服务端判定（#5），这里只管显示密码、失败时的轻摆和提交时的按钮文字。
// 2026-11-22（#116）由原来的 icons.js、gc.js、pages.js、login.js 收成这一个文件，行为不变；图标只留登录页用到的两个。
// 图标：Heroicons v2.2.0（MIT，Tailwind Labs，见 icons-LICENSE.txt），24 网格，线框 1.5 描边，颜色跟随 currentColor。
(() => {
  const ICONS = {
    'eye': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>',
    'eye-off': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88"/></svg>',
  };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const anim = (el, kf, o) => (reduced() || !el ? null : el.animate(kf, { easing: 'cubic-bezier(.25, 1, .5, 1)', ...o }));

  // 显示密码；服务端已判定失败时表单轻摆，再输入时清掉错误样式；提交时按钮变「登录中」防重复提交。
  const form = document.getElementById('form');
  const err = $('.err', form), peek = $('#peek', form), pass = $('#pass', form);
  if (peek) {
    peek.innerHTML = ICONS.eye;
    peek.addEventListener('click', () => {
      const show = pass.type === 'password';
      pass.type = show ? 'text' : 'password';
      peek.innerHTML = show ? ICONS['eye-off'] : ICONS.eye;
      peek.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
    });
  }
  if (!err.hidden) anim(form, [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 280 });
  form.addEventListener('input', () => { if (!err.hidden) { err.hidden = true; $$('.field', form).forEach((f) => f.removeAttribute('data-error')); } });
  form.addEventListener('submit', () => { const btn = $('[type="submit"]', form); btn.disabled = true; btn.textContent = '登录中'; });
})();
