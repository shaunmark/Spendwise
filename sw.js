// ── Spendwise Service Worker ──────────────────────────────────────────────────
// Handles: offline caching, scheduled daily reminder notifications
// Version bump here forces SW update on redeploy
const SW_VERSION = 'spendwise-v1';

const CACHE_NAME = SW_VERSION;

// Files to cache for offline use
const PRECACHE = [
  './',
  './index.html',
  './manifest.json'
];

// ── INSTALL: cache app shell ──────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cache what we can; don't fail install if external resources (fonts) miss
      return cache.addAll(PRECACHE).catch(() => {});
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: clean old caches ────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => {
      self.clients.claim();
      // Tell the page SW is ready
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: 'SW_READY' }))
      );
    })
  );
});

// ── FETCH: cache-first for app shell, network-first for fonts/external ────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always go network for external resources (Google Fonts etc)
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for local app files
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache successful GET responses for app files
        if (event.request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback: serve index.html for navigation requests
        if (event.request.mode === 'navigate') return caches.match('./index.html');
      });
    })
  );
});

// ── MESSAGES from app ─────────────────────────
self.addEventListener('message', event => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'SCHEDULE_REMINDER') {
    const { lastEntry, today, reminderHour } = data;

    // Clear any existing reminder alarm
    clearTimeout(self._reminderTimeout);

    // Don't notify if already logged today
    if (lastEntry === today) return;

    // Calculate ms until next reminderHour (default 21:00)
    const now = new Date();
    const target = new Date();
    target.setHours(reminderHour ?? 21, 0, 0, 0);

    // If target time already passed today, schedule for tomorrow
    if (target <= now) target.setDate(target.getDate() + 1);

    const delay = target.getTime() - now.getTime();

    self._reminderTimeout = setTimeout(() => {
      // Re-check: fetch latest data from IndexedDB isn't easy in SW,
      // so we fire the notification and let the user dismiss if not needed
      self.registration.showNotification('Spendwise 💰', {
        body: "Don't forget to log today's expenses!",
        icon: './icon-192.png',
        badge: './icon-192.png',
        tag: 'daily-reminder',          // replaces previous if not dismissed
        renotify: false,
        requireInteraction: false,
        actions: [
          { action: 'open', title: 'Log now' },
          { action: 'dismiss', title: 'Dismiss' }
        ],
        data: { url: self.registration.scope }
      });
    }, delay);
  }
});

// ── NOTIFICATION CLICK ────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  // Focus existing window or open new one
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url.includes(self.registration.scope));
      if (existing) return existing.focus();
      return self.clients.openWindow(event.notification.data?.url || self.registration.scope);
    })
  );
});

// ── PUSH (future server-based push support) ───
// Currently unused — app uses local scheduling only.
// If you add a push server later, handle it here:
self.addEventListener('push', event => {
  if (!event.data) return;
  const payload = event.data.json();
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Spendwise', {
      body: payload.body || 'Time to log your expenses!',
      icon: './icon-192.png',
      tag: 'push-reminder',
      data: { url: self.registration.scope }
    })
  );
});
