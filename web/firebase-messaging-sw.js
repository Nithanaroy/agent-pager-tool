importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");
importScripts("/config.js");

// Take over from an older service worker right away (no waiting for all tabs to close).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Handle taps ourselves (registered before the FCM SDK's listener). iOS may just focus an
// already-open Pager window without navigating, so we also save the message and post it to
// the window; the page renders whatever arrives.
self.addEventListener("notificationclick", (event) => {
  const fcm = (event.notification.data || {}).FCM_MSG || {};
  const link = (fcm.fcmOptions || fcm.fcm_options || {}).link;
  if (!link || new URL(link).origin !== self.location.origin) return;
  event.stopImmediatePropagation();
  event.notification.close();
  const hash = new URL(link).hash;
  event.waitUntil((async () => {
    const cache = await caches.open("pager");
    await cache.put("/__last", new Response(hash));
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.length) {
      wins[0].postMessage({ type: "pager-message", hash });
      return wins[0].focus();
    }
    return self.clients.openWindow(link);
  })());
});

firebase.initializeApp(self.FIREBASE_CONFIG);
// Messages with a `webpush.notification` payload are displayed automatically while the PWA is
// closed; tapping one opens `fcm_options.link` (the message page).
firebase.messaging();
