/* 尽早应用主题，避免黑夜模式刷新时闪白。外移为独立文件以满足 CSP script-src 'self' */
try { if (localStorage.getItem('gamenight-theme') === 'dark') document.documentElement.setAttribute('data-theme', 'dark'); } catch (e) {}
