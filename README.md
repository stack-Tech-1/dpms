# DPMS

A free, offline-first stock and buying app for small Nigerian shops and makers. Check your shelf in a minute, plan your buying around today's cash, and send orders on WhatsApp.

## Run it locally

The app has no build step. Offline support needs a web server, so serve the folder rather than opening the file directly:

```
npx serve .
```

## Test it

```
node --test tests/engine.test.js
```

## Project layout

| Path | Purpose |
| --- | --- |
| `index.html` | Landing page and app frame |
| `css/app.css` | Visual system, light and dark |
| `js/engine.js` | Stock, value, budget and newsvendor calculations |
| `js/catalog.js` | Starter items offered during setup |
| `js/app.js` | Screens and saved records |
| `sw.js` | Offline support |

## Releasing a change

Raise `VERSION` in `sw.js` whenever you change a file, otherwise installed copies keep the old version.

## Where data lives

All records stay in the browser on the user's device. There is no server or account, so users should download backups from Settings.
