/**
 * Installable-app plumbing: the offline service worker, the "Install" prompt (Android/desktop Chrome) or the
 * Share → Add to Home Screen hint (iOS Safari), and an immersive capture mode (fullscreen, portrait, screen awake).
 */

type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };

export const isInstalled = () =>
  matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  addEventListener('load', () => { navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => { /* offline support is optional */ }); });
}

export function setupInstall(card: HTMLElement, button: HTMLButtonElement, hint: HTMLElement) {
  if (isInstalled()) return;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) {
    hint.textContent = 'In Safari, tap Share, then “Add to Home Screen”. It opens full screen and works offline.';
    card.hidden = false;
  }
  let deferred: InstallPrompt | null = null;
  addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferred = event as InstallPrompt;
    card.hidden = false;
    button.hidden = false;
  });
  button.addEventListener('click', async () => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    if (outcome === 'accepted') card.hidden = true;
  });
  addEventListener('appinstalled', () => { card.hidden = true; });
}

let wakeLock: { release(): Promise<void> } | null = null;

/** Call synchronously inside the tap that starts a scan: browsers only allow fullscreen from a user gesture. */
export function enterImmersive() {
  const root = document.documentElement;
  if (!isInstalled() && document.fullscreenEnabled && !document.fullscreenElement) {
    root.requestFullscreen({ navigationUI: 'hide' }).then(lockPortrait, () => { /* not allowed here: keep going */ });
  } else lockPortrait();
  const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
  nav.wakeLock?.request('screen').then(lock => { wakeLock = lock; }, () => { /* the screen may dim */ });
}

function lockPortrait() {
  const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  orientation?.lock?.('portrait').catch(() => { /* only allowed fullscreen or installed */ });
}

export function exitImmersive() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  if (document.fullscreenElement && !isInstalled()) document.exitFullscreen().catch(() => {});
}
