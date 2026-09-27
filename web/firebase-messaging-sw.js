importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");
importScripts("/config.js");

firebase.initializeApp(self.FIREBASE_CONFIG);
// Messages with a `webpush.notification` payload are displayed automatically while the PWA is
// closed; tapping one opens `fcm_options.link` (the message page).
firebase.messaging();
