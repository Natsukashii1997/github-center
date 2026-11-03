// 登录页的拼装（#14，照冻结方案 t1b-pages-r1 的 design/t1b-pages/pages.js 落地；2026-11-03 白雾重设计后其余页面不再用，我的收藏 #22 起也改用 bw.js）。组件来自 gc.js。
window.GP = (() => {
  const { I, $, $$, anim } = GC;
  // 登录页：显示密码；服务端已判定失败时表单轻摆，再输入时清掉错误样式
  function wireLogin(form) {
    const err = $('.err', form), peek = $('#peek', form), pass = $('#pass', form);
    if (peek) { peek.innerHTML = I.eye; peek.addEventListener('click', () => { const show = pass.type === 'password'; pass.type = show ? 'text' : 'password'; peek.innerHTML = show ? I['eye-off'] : I.eye; peek.setAttribute('aria-label', show ? '隐藏密码' : '显示密码'); }); }
    if (!err.hidden) anim(form, [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 280 });
    form.addEventListener('input', () => { if (!err.hidden) { err.hidden = true; $$('.field', form).forEach((f) => f.removeAttribute('data-error')); } });
    form.addEventListener('submit', () => { const btn = $('[type="submit"]', form); btn.disabled = true; btn.textContent = '登录中'; });
  }
  return { wireLogin };
})();
