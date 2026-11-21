let sentinel: WakeLockSentinel | null = null;
let desired = false;
let pending = false;

const supported =
  typeof navigator !== 'undefined' && 'wakeLock' in navigator && typeof document !== 'undefined';

function pageVisible(): boolean {
  return document.visibilityState === 'visible';
}

async function acquire(): Promise<void> {
  if (!supported || sentinel !== null || pending || !pageVisible()) {
    return;
  }
  pending = true;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (!desired || !pageVisible()) {
      await lock.release();
      return;
    }
    sentinel = lock;
    lock.addEventListener('release', () => {
      if (sentinel === lock) {
        sentinel = null;
      }
    });
  } catch {
    sentinel = null;
  } finally {
    pending = false;
  }
}

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
    if (desired && pageVisible()) {
      void acquire();
    }
  });
}
