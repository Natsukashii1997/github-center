// 样稿 signals-r1（#16）：地址参数 ?theme=dark / light 看深浅色（默认跟系统）。放在 <head> 里，页面画出来之前就定好主题。
(() => { const t = new URLSearchParams(location.search).get('theme'); if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t; })();
