// Firebase initialization — attaches to `window` so every other script
// (loaded via plain <script> tags, no modules) can use `window.db` / `window.auth`.

const firebaseConfig = {
  apiKey: "AIzaSyDxHwZZStaH562uoB54XyosNeRHxR4vBLI",
  authDomain: "causepass.firebaseapp.com",
  projectId: "causepass",
  storageBucket: "causepass.firebasestorage.app",
  messagingSenderId: "386710631650",
  appId: "1:386710631650:web:826348b160ad633d599abb",
};

firebase.initializeApp(firebaseConfig);
window.db = firebase.firestore();
window.auth = firebase.auth();
