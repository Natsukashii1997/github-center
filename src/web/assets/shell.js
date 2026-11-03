// 白雾外壳的背景：ascii-sharks（MIT，见 sharks-LICENSE.txt）画在 #sea 上，样式里反色成白底灰鲨鱼（同定稿原型 r2.js 的 sharks）。
new window.AsciiSharks.OceanEngine(document.getElementById('sea'), ['greathammer', 'nurse', 'mako', 'classic'].map((kind, i) => ({ kind, size: 1 - i * 0.1 })));
