/**
 * The theme bootstrap script, inlined in the root layout so the page never flashes the wrong
 * theme. The CSP in middleware.ts whitelists exactly this text by its SHA-256 hash, so the
 * string below must stay byte-for-byte identical. A unit test (tests/unit/theme-script) fails
 * the build if the script is ever edited without updating the hash.
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('pe-theme');if(t!=='light'&&t!=='dark'){t=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;

/** CSP source token for the script above (sha256 of the exact text, base64). */
export const THEME_SCRIPT_HASH = "sha256-XlPKxlCjID0Hfz5Ej1TwKIyqwO4yl7yGriMW9XiZLp8=";
