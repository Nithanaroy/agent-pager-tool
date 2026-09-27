import "/config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getMessaging, getToken, onMessage, isSupported } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js";

const $ = (id) => document.getElementById(id);
const setStatus = (msg) => { $("status").textContent = msg; };

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

// Full message rides in the URL fragment (#m=<base64url JSON>), so it never reaches the server.
function decodeMessage(hash) {
  const m = new URLSearchParams(hash.replace(/^#/, "")).get("m");
  if (!m) return null;
  const b64 = m.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(b64 + "===".slice((b64.length + 3) % 4)), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function showMessage() {
  let msg = null;
  try { msg = decodeMessage(location.hash); } catch (e) { setStatus(`Could not read message: ${e.message}`); }
  $("msg").hidden = !msg;
  if (!msg) return;
  $("msgTitle").textContent = msg.t || "";
  $("msgTime").textContent = msg.ts ? new Date(msg.ts * 1000).toLocaleString() : "";
  $("msgBody").textContent = msg.b || "";
  const safeLink = typeof msg.l === "string" && msg.l.startsWith("https://");
  $("msgLink").hidden = !safeLink;
  if (safeLink) $("msgLink").href = msg.l;
}

async function registerToken() {
  const swReg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
  await navigator.serviceWorker.ready;
  const messaging = getMessaging(initializeApp(self.FIREBASE_CONFIG));
  const token = await getToken(messaging, { vapidKey: self.VAPID_KEY, serviceWorkerRegistration: swReg });
  if (!token) throw new Error("No token returned");

  $("token").value = token;
  $("tokenBox").hidden = false;
  $("enable").hidden = true;
  const prev = localStorage.getItem("fcmToken");
  localStorage.setItem("fcmToken", token);
  if (prev && prev !== token) {
    $("tokenBox").open = true;
    setStatus("Token CHANGED - re-register it on your Mac.");
  } else {
    setStatus("Ready. Notifications enabled.");
  }

  // App open in the foreground: render the incoming message in place.
  onMessage(messaging, (payload) => {
    const link = payload.fcmOptions && payload.fcmOptions.link;
    if (link && link.startsWith(location.origin)) location.hash = new URL(link).hash;
  });
}

async function main() {
  showMessage();
  if (isIOS && !isStandalone) {
    setStatus("Tap Share -> Add to Home Screen, then open Pager from the home screen.");
    return;
  }
  if (!("serviceWorker" in navigator) || !(await isSupported())) {
    setStatus("Push is not supported in this browser (iOS needs 16.4+ and a home-screen app).");
    return;
  }
  if (Notification.permission === "granted") {
    await registerToken();
    return;
  }
  if (Notification.permission === "denied") {
    setStatus("Notifications are blocked. Re-enable in Settings -> Notifications -> Pager.");
    return;
  }
  setStatus("Tap the button to allow notifications.");
  $("enable").hidden = false;
  // iOS requires the permission prompt to come from a user gesture.
  $("enable").onclick = async () => {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return setStatus(`Permission: ${perm}`);
    await registerToken();
  };
}

window.addEventListener("hashchange", showMessage);

// Tapped notification while the app was already open: the service worker posts the message.
const setHash = (hash) => { if (hash && hash !== location.hash) location.hash = hash; };
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data && e.data.type === "pager-message") setHash(e.data.hash);
  });
}
async function loadLastTapped() {
  if (!("caches" in window)) return;
  const res = await (await caches.open("pager")).match("/__last");
  if (res) setHash(await res.text());
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadLastTapped(); });

$("msgCopy").onclick = async () => {
  await navigator.clipboard.writeText(`${$("msgTitle").textContent}\n\n${$("msgBody").textContent}`);
  setStatus("Message copied.");
};
$("copy").onclick = async () => {
  await navigator.clipboard.writeText($("token").value);
  setStatus("Token copied.");
};
$("share").onclick = () => navigator.share && navigator.share({ text: $("token").value });

main().catch((e) => setStatus(`Error: ${e.message}`));
if (!location.hash) loadLastTapped();
