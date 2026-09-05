# Rezka Fullwindow

A Chrome extension that expands the Rezka video player to fill the browser window.
Browser tabs remain visible. The video keeps its proportions, so black bars can remain.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** and click **Load unpacked**.
4. Select the repository's **src** folder.
5. Reload your [Rezka video page](https://rezka.ag/series/drama/49231-medved-2022-latest.html).

No build is needed for installation. You can also load the generated `dist` folder,
or extract the release ZIP and load the extracted folder.

If you installed an earlier version from the repository root, remove that installation
and load `src` instead.

## Use

- Click **Fill window** at the top right of the page.
- Click **Restore player** or press **Escape** to restore the page.
- The extension toolbar icon and **Alt+Shift+W** also toggle the player size.
- Change the shortcut at `chrome://extensions/shortcuts` if it conflicts with another shortcut.
- Restore the page to select another episode or translation.

If an embedded player has keyboard focus, Escape may not reach the page.
Use **Restore player**, the toolbar icon, or the extension shortcut in that case.
When native fullscreen is active, Escape first exits native fullscreen.

## Develop

Use Node.js 20 or later.

```sh
npm ci
npx playwright install chromium
npm run verify
```

| Command | Result |
| --- | --- |
| `npm run check` | Check JavaScript syntax, manifest paths, permissions, and version consistency. |
| `npm run build` | Copy the extension to `dist/` and create a versioned ZIP in `artifacts/`. |
| `npm test` | Run worker unit tests and installed-extension browser tests. Run the build first. |
| `npm run verify` | Run all checks, the build, and tests. |

The browser tests use a separate Chromium profile. They load the actual extension and
serve a controlled test page at the Rezka URL. They cover resizing, restoration,
keyboard access, player replacement, control creation, and Chrome messaging.
Worker tests cover toolbar actions, unsupported URLs, and closed tabs.
They do not test live streaming or the site's external services.

GitHub Actions runs the same checks for pushes and pull requests. A successful run
provides the extension ZIP as a workflow artifact.

```text
src/                  Installable extension source and manifest
scripts/              Manifest validation and ZIP build
tests/               Worker and browser tests
.github/workflows/    Continuous integration
```

## Permissions and privacy

Automatic access is limited to `rezka.ag` and its subdomains. The `activeTab` and
`scripting` permissions let a toolbar click initialize a tab that was open before
installation. The extension rejects toolbar actions on other sites.

The extension does not collect data, store browsing history, or make network requests.
It leaves the player in its original DOM position to avoid restarting playback.
Build and test dependencies are not included in the extension ZIP.

## Limits

The site must load the video successfully for playback to work. This extension only
changes the layout. Site changes can require updates to the player selectors.
Other Rezka mirror domains are not supported.

The initial live-page check confirmed player expansion and restoration. The live site
did not load a video in that browser, so live playback remains unverified.

Chrome references: [content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
and [script injection](https://developer.chrome.com/docs/extensions/reference/api/scripting).
