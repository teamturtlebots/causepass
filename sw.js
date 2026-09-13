// This service worker exists only to satisfy installability requirements
// (a registered service worker is one of the checks Chrome/Android make
// before offering the "Install app" prompt).
//
// It deliberately has NO fetch handler. Intercepting network requests here
// would also intercept Firestore's live-update connection (onSnapshot),
// which is a real, known source of flaky "listeners stop updating"
// bugs elsewhere — and it's not actually required for installability
// anymore, so there's no upside to the risk.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  self.clients.claim();
});
