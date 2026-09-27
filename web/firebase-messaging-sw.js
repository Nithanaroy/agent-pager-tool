importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");
importScripts("/config.js");

// Take over from an older service worker right away (no waiting for all tabs to close).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Every message is saved to a small inbox the moment it arrives, so the page can always show it,
// whatever iOS does with the tap. The message itself is the "#m=..." fragment of its link.
const INBOX = "/__inbox";
const findHash = (text) => ((text || "").match(/#m=[A-Za-z0-9_-]+/) || [])[0];

async function saveToInbox(hash) {
  const cache = await caches.open("pager");
  const res = await cache.match(INBOX);
  const list = (res ? await res.json() : []).filter((h) => h !== hash);
  list.unshift(hash);
  await cache.put(INBOX, new Response(JSON.stringify(list.slice(0, 20))));
}

// Registered before the FCM SDK's listener; the SDK still shows the notification.
self.addEventListener("push", (event) => {
  let text = "";
  try { text = event.data ? event.data.text() : ""; } catch (e) { /* not text */ }
  const hash = findHash(text);
  if (hash) event.waitUntil(saveToInbox(hash));
});

// Handle taps ourselves: focus an open Pager window and tell it which message to show,
// or open a new one at the message URL.
self.addEventListener("notificationclick", (event) => {
  const hash = findHash(JSON.stringify(event.notification.data || {}));
  event.stopImmediatePropagation();
  event.notification.close();
  event.waitUntil((async () => {
    if (hash) await saveToInbox(hash);
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.length) {
      wins[0].postMessage({ type: "pager-message", hash });
      return wins[0].focus();
    }
    return self.clients.openWindow("/" + (hash || ""));
  })());
});

firebase.initializeApp(self.FIREBASE_CONFIG);
// Messages with a `webpush.notification` payload are displayed automatically while the PWA is
// closed; tapping one opens `fcm_options.link` (the message page).
firebase.messaging();
