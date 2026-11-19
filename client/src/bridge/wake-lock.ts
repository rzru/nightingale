/**
 * Screen Wake Lock wrapper: keeps the display from dimming/locking while a
 * song is actively playing. Backed by the standard `navigator.wakeLock` API,
 * which Tauri's webviews (WebView2, WKWebView) expose the same as a browser
 * tab, so no Tauri-specific adapter is needed here.
 *
 * The browser force-releases the lock whenever the document goes hidden (tab
 * switch, app backgrounded, screen locked), so `setWakeLockDesired` tracks
 * whether a lock is wanted and re-requests it on `visibilitychange` once the
 * page is visible again.
 */

let sentinel: WakeLockSentinel | null = null;
let desired = false;

const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

async function acquire(): Promise<void> {
  if (!supported || sentinel !== null || document.visibilityState !== 'visible') {
    return;
  }
  try {
    const lock = await navigator.wakeLock.request('screen');
    sentinel = lock;
    lock.addEventListener('release', () => {
      if (sentinel === lock) {
        sentinel = null;
      }
    });
  } catch {
    // Denied or unsupported in this context (e.g. low battery on some
    // platforms) -- the screen may dim; there's no user-facing recovery.
    sentinel = null;
  }
}

/** Marks whether the caller currently wants the screen kept awake. */
export function setWakeLockDesired(next: boolean): void {
  if (desired === next) {
    return;
  }
  desired = next;
  if (next) {
    void acquire();
    return;
  }
  const lock = sentinel;
  sentinel = null;
  void lock?.release().catch(() => {});
}

if (supported) {
  document.addEventListener('visibilitychange', () => {
    if (desired && document.visibilityState === 'visible') {
      void acquire();
    }
  });
}
