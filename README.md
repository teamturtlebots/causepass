# CausePass — vanilla JS version (no Node, no npm, no build step)

Same app, same Firebase project, same data model as the earlier React
version — rewritten in plain HTML/CSS/JavaScript so nothing needs to be
installed or built on your computer.

## Files

```
index.html          the whole page — loads Firebase from a CDN, then the app's own scripts
style.css            all styling
js/firebase-config.js   your Firebase project config (already filled in)
js/utils.js          small shared helper functions
js/customer.js        the public pass screen (no login)
js/admin.js           the admin login + dashboard
js/app.js             routes between the two, based on the URL and login state
firestore.rules       same security rules as before — schema didn't change
```

## Try it locally first

Because this uses plain `<script>` tags (not JavaScript "modules"), you can
literally **double-click `index.html`** and it'll open in your browser and
work, internet connection permitting (it still needs to reach Firebase's
servers). No terminal, no install, nothing to run first.

## Deploying to GitHub Pages

This is simpler than the React version — there's no build step, so you're
just publishing these files as-is.

1. Create a GitHub repo (or reuse the one you already made).
2. On github.com, use **Add file → Upload files** and drag in `index.html`,
   `style.css`, and the `js` folder — no terminal required for this step if
   you'd rather do it entirely through the browser.
   (Or, if you're comfortable with git: `git add .`, `git commit -m "..."`,
   `git push` — same as before, just no `npm run build`/`npm run deploy`
   step needed, since there's nothing to build.)
3. Repo → **Settings → Pages** → Source: **Deploy from a branch** → Branch:
   `main`, folder `/ (root)` → Save.
4. Wait a minute, refresh, and GitHub shows your live URL.

## The one Firebase step, same as before

Add your live GitHub Pages domain to **Authentication → Settings →
Authorized domains** in the Firebase console, or admin sign-in will fail
once deployed even though it worked when you opened `index.html` locally.

## What's different from the React version, functionally

Nothing — same screens, same redemption transaction, same security rules,
same admin/customer split. The only thing that changed is *how* it's built:
no React, no Node, no npm, no build tool. Every file here is exactly what
the browser runs, with nothing translating or compiling it first.
