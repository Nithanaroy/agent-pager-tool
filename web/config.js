// Public Firebase web config (safe to ship: these identify the project, they are not secrets).
// Firebase console -> Project settings -> General -> Your apps -> Web app -> SDK setup (Config).
self.FIREBASE_CONFIG = {
  apiKey: "AIzaSyDZ8QXdpPm4Kg-Y2gKvASsvq7uugllVvVA",
  authDomain: "agent-pager.firebaseapp.com",
  projectId: "agent-pager",
  storageBucket: "agent-pager.firebasestorage.app",
  messagingSenderId: "216080199202",
  appId: "1:216080199202:web:e509e19d98f8a89c4e647b",
};

// Firebase console -> Project settings -> Cloud Messaging -> Web Push certificates -> Key pair (public key).
self.VAPID_KEY = "BFP1QpSjfzkNLnB0O9AiveuoMvC0pKlzglXIg2ssikiiNFqhXLiRjTO9OC5ShNuSa-tj4F5YiUIjW7q3vQgqVN4";
