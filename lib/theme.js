export const THEME_STORAGE_KEY = 'ticketing:theme';

export const THEME_MODES = ['light', 'dark', 'system'];

export const THEME_DEFAULT = 'light';

export const THEME_INIT_SCRIPT = `(function(){try{var m=localStorage.getItem('ticketing:theme');if(m!=='light'&&m!=='dark'&&m!=='system'){m='light';}var d=m==='dark';if(m==='system'){d=!!(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);}var r=document.documentElement;r.setAttribute('data-theme',d?'dark':'light');r.setAttribute('data-theme-mode',m);r.style.colorScheme=d?'dark':'light';}catch(e){}})();`;
