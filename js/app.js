// ================= APP ENTRY / ROUTER =================

let currentUser = undefined; // undefined = auth state not checked yet
let currentIsAdmin = false;

function route() {
  const token = getCustomerTokenFromHash();
  if (token) {
    CustomerView.init(token);
    return;
  }

  if (currentUser === undefined) {
    document.getElementById("app").innerHTML = `<div class="centered">Loading…</div>`;
    return;
  }
  if (!currentUser) {
    AdminView.initLogin(false);
    return;
  }
  if (!currentIsAdmin) {
    AdminView.initLogin(true);
    return;
  }
  AdminView.initDashboard(currentUser);
}

// Single auth listener for the whole app's lifetime.
auth.onAuthStateChanged(async (user) => {
  currentUser = user;
  currentIsAdmin = false;
  if (user) {
    const adminDoc = await db.collection("admins").doc(user.uid).get();
    currentIsAdmin = adminDoc.exists;
  }
  route();
});

window.addEventListener("hashchange", route);

// Run once immediately on load — otherwise a customer opening a #/p/TOKEN link
// would sit waiting on an admin auth check that has nothing to do with them,
// before the router ever looks at the URL. The auth listener above still
// re-routes once it resolves, for the admin path.
route();
