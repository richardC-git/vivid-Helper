# Vivid Watcher Helper (Scalpel plugin)

Prices the **level 20 / quality 20 support gems** that Vivid Watcher crafts produce. It scans your Path of Exile 1 inventory, identifies each gem from its icon art, and prices the whole inventory at once from the poe.ninja data Scalpel already keeps. No trade API calls.

## Installing

The easiest way is the patched Scalpel build from the fork (`../scalpel-gems`, branch `gem-scanner`). It comes with this plugin preinstalled and exposes the price variant needed for exact 20/20 prices:

1. Download `Scalpel-Setup.exe` from the fork's GitHub Releases and run it. It installs over an existing Scalpel and keeps your settings. The build is unsigned, so Windows SmartScreen will ask: click *More info* > *Run anyway*.
2. Launch Scalpel. The **Vivid Watcher Helper** tab is already there.

The fork's auto-updater follows the fork's own releases, so upstream Scalpel releases won't replace it. To get back to official Scalpel, reinstall it from upstream.

To ship a new plugin version in the fork: bump `version` in `manifest.json`, run `npm run bundle`, then commit in the fork and cut a release there.

## Using it

1. Bind **Scan inventory gems** in Scalpel's Settings > Macros > Plugin Hotkeys. Optionally bind **Toggle gem overlay** too.
2. In game, open your inventory and press the scan hotkey. The plugin captures the game window, reads the 12x5 grid and draws prices straight over your inventory, so the game keeps focus:
   - **green** outline: at or above your minimum price, labelled with its value (`93c`, `1.2d`)
   - **dark tint**: below the minimum, with a dim price, safe to skip
   - **amber** with `?`: look-alike art, labelled with the higher candidate's price
   - **dashed**: no 20/20 price on poe.ninja; **red**: unreadable cell

   The overlay is click-through, so you can hover and move gems underneath it. Esc (or the toggle hotkey) hides it. It shows the last scan, so rescan after moving or selling gems. If a scan fails, the tab opens instead to show why.
3. The plugin's tab in Scalpel lists each gem type with its count, unit price and total, plus a grand total in chaos and divines.
4. Set **Min price** in the tab to hide cheap gems: they collapse into one "N gems under X" row that still counts towards the total, and fade on the overlay. Look-alikes and price ranges are judged by their highest possible value. Clear it to show everything.
5. Switch the list to **Inventory order** to get one row per gem in the order PoE fills the inventory (down each column, then across), with its slot as column-row, so you can work through the inventory alongside it. Both choices are remembered.

Rows marked **look-alike art** are gems whose icons can't be told apart, e.g. *Communion* and *Minion Pact*, which share identical art. Both candidates and their prices are shown, so hover the gem in game to see which it is.

### Calibration

The inventory position is computed from the game window size, using the 1080p layout as reference. Open **Calibration** in the tab to see the last capture with the scan grid drawn over it (green = matched, amber = look-alike, red = unreadable, grey = empty). If the boxes don't sit on the cells, nudge them with the offset and cell-size controls. Changes rescan the last capture immediately and are saved. Scans also auto-correct small offsets by themselves.

## Limitations

- **Windows only.** `captureGameWindow` returns nothing on other platforms, and PoE must be the focused window, so use the hotkey rather than the tab button.
- **Exact 20/20 prices need the patched Scalpel.** Official Scalpel 1.0.5 drops poe.ninja's level/quality `variant` from the price data it gives plugins, so there every gem shows the range across all its listings (level 1 through 21/23c). The fork includes the fix ([`upstream/0001-price-entry-variant.patch`](upstream/0001-price-entry-variant.patch), also suitable as an upstream PR), and the plugin uses exact `20/20` prices when it's present.
- Prices are poe.ninja's, so gems with very few listings can show unrealistic values (outlier asks dominate a thin market). This mostly settles once a league is active.
- Only support gems are recognised, and only the `20/20` poe.ninja line is priced. Gems that never appear as 20/20 on poe.ninja (Awakened and exceptional supports, among others) show no price.

## Development

```bash
npm install
npm run build      # dist/plugin.js + dist/manifest.json
npm test           # unit tests
npm run sim        # matcher accuracy on synthetic inventory renders
npm run build:refs # regenerate src/data/gem-refs.json (new league gems)
```

Load `dist/` with Scalpel's Settings > Developer > *Load unpacked plugin...*, or `npm run bundle` to copy it into the fork.

### How recognition works

The plugin can't read GGG's icon images at runtime (the CDN sends no CORS headers), so `npm run build:refs` downloads every support-gem icon listed in Scalpel's `item-data` index (pinned to a commit) and bundles a 16x16 fingerprint of each. At scan time each inventory cell is downsampled the same way (`src/fingerprint.ts`) and compared against all fingerprints, with the reference composited over the cell's own background. A small whole-grid offset search absorbs calibration error first.

On synthetic renders at 720p-4K cell sizes, with up to 3px misalignment and ±20% brightness, `npm run sim` reports 99.6% correct, 0.4% look-alike (the identical-art pair), 0% wrong, and about 130ms per scan. Real captures still need confirming; tune `EMPTY_STDDEV` / `MATCH_MAX_DISTANCE` in `src/match.ts` if needed.
