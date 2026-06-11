(function() {
  'use strict';
  function waitForTelegram(retries) {
    if (window.Telegram && window.Telegram.WebApp) return init();
    if (retries > 10) return;
    setTimeout(() => waitForTelegram(retries + 1), 100);
  }
  
  function init() {
    const tg = window.Telegram.WebApp;
    tg.ready();
    tg.expand();
    
    syncTheme();
    tg.onEvent('themeChanged', syncTheme);
    
    createTopBar(tg);
  }
  
  function syncTheme() {
    const tg = window.Telegram.WebApp;
    const root = document.documentElement;
    const props = [
      '--tg-theme-bg-color', '--tg-theme-text-color', '--tg-theme-button-color',
      '--tg-theme-button-text-color', '--tg-theme-secondary-bg-color',
      '--tg-theme-link-color', '--tg-theme-hint-color', '--tg-theme-destructive-text-color',
      '--tg-theme-section-bg-color', '--tg-theme-header-bg-color',
      '--tg-theme-accent-text-color', '--tg-theme-section-header-text-color',
      '--tg-theme-subtitle-text-color', '--tg-theme-bottom-bar-bg-color',
      '--tg-safe-area-inset-top', '--tg-content-safe-area-inset-right',
      '--tg-content-safe-area-inset-left', '--tg-content-safe-area-inset-bottom'
    ];
    props.forEach(p => {
      if (tg.themeParams && tg.themeParams[p.replace('--tg-', '').replace(/-/g, '_')]) {
        root.style.setProperty(p, tg.themeParams[p.replace('--tg-', '').replace(/-/g, '_')]);
      }
    });
    root.dataset.tgTheme = tg.colorScheme || 'dark';
    root.style.colorScheme = tg.colorScheme || 'dark';
  }
  
  function createTopBar(tg) {
    if (document.querySelector('.top-bar')) return;
    
    const topBar = document.createElement('header');
    topBar.className = 'top-bar';
    
    const content = document.createElement('div');
    content.className = 'top-bar-content';
    
    const menuBtn = document.createElement('button');
    menuBtn.className = 'menu-button';
    menuBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    menuBtn.title = 'Sessions';
    menuBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      const nativeTrigger = document.querySelector('button[aria-haspopup="menu"]');
      if (nativeTrigger) { nativeTrigger.click(); return; }
      const els = document.querySelectorAll('button');
      for (let i = 0; i < els.length; i++) {
        if (els[i].textContent.includes('Session')) { els[i].click(); return; }
      }
    });
    
    const title = document.createElement('div');
    title.className = 'top-bar-title';
    title.textContent = 'OpenCode';
    
    const rightActions = document.createElement('div');
    rightActions.className = 'top-bar-right';
    
    if (tg.requestFullscreen) {
      const fsBtn = document.createElement('button');
      fsBtn.className = 'top-bar-action-button';
      fsBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      fsBtn.title = 'Fullscreen';
      fsBtn.addEventListener('click', function() { tg.requestFullscreen(); });
      rightActions.appendChild(fsBtn);
    }
    
    content.appendChild(menuBtn);
    content.appendChild(title);
    content.appendChild(rightActions);
    topBar.appendChild(content);
    
    const target = document.querySelector('#root') || document.body;
    target.insertBefore(topBar, target.firstChild);
  }
  
  waitForTelegram(0);
})();
