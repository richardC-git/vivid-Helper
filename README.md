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

   The overlay is click-through, so you can hover and move gems underneath it. Close it with the ✕ above the inventory or the toggle hotkey; Esc deliberately doesn't close it. It shows the last scan, so rescan after moving or selling gems. If a scan fails, the tab opens instead to show why.
3. The plugin's tab in Scalpel lists each gem type with its count, unit price and total, plus a grand total in chaos and divines.
4. Set **Min price** in the tab to hide cheap gems: they collapse into one "N gems under X" row that still counts towards the total, and fade on the overlay. Look-alikes and price ranges are judged by their highest possible value. Clear it to show everything. **Hide no-price** leaves gems without a 20/20 price off the overlay and the list too. **Chaos only** labels the overlay in chaos even for gems worth a divine or more (the list is always in chaos).
5. Switch the list to **Inventory order** to get one row per gem in the order PoE fills the inventory (down each column, then across), with its slot as column-row, so you can work through the inventory alongside it. Both choices are remembered.

### Craft log and EV

Every successful scan also feeds a craft log for working out what a Vivid Watcher is worth. The log is slot-based: a scan logs only the gems in slots that are new or changed since the last logged scan, so rescanning, reopening the overlay, or scanning after selling some gems never counts a gem twice. The overlay's status line says what each scan did ("+12 gems logged", "No new gems to log"). Scans with several unreadable cells aren't logged at all, and a gem that misreads once isn't recounted when it reads again. When under a quarter of the gems are unchanged, the inventory is treated as a new run (the last one was sold or stashed) and everything is logged, so the same gem landing in the same slot in consecutive runs still counts. Moving a gem to another slot does count it again, so don't rearrange gems between scans (or use **Undo last scan**).

For testing, switch **Logging off** in the Craft log section. Scans then still track what's in each slot but add nothing to the log, so gems scanned while testing aren't swept in when logging is turned back on; only gems that change afterwards are logged. The overlay's status line reads "Logging off" as a reminder.

The **Craft log** section in the tab shows, at current poe.ninja prices:

- **EV per craft**: 3 x the mean logged gem value, with a 95% confidence interval. Gems with no 20/20 price count as 0; look-alikes count as the mean of their candidates.
- **Profit per craft** against what a craft costs: the Vivid Watcher (poe.ninja's price, or one you enter), plus 3 yellow beasts at a price you enter, plus the exceptional gem chosen in the finder. Unset ingredients count as free and the cost line says so. **Refresh prices** asks Scalpel to re-fetch poe.ninja now.
- The gems contributing most of the value.

**Leagues.** The first scan that logs gems in a new league moves the earlier leagues' scans into an archive (storage key `craftLogArchive`), kept whole. Gem occurrences are about the craft, not the economy, so archived scans keep counting towards the EV sample under **Sample: All leagues**, while every EV is priced at the current league. **This league** narrows the sample to scans logged in the current league, in case the craft's odds change. **Clear log** clears only the current league's scans; **Clear archive** deletes the archive; **Copy CSV** exports both, oldest first.

The log lives in Scalpel's plugin storage (`%APPDATA%\scalpel\plugins\gem-scanner\storage.json`, key `craftLog`): one entry per logged scan with its time, league, plugin version and icon-reference version, and for each gem its slot, name (look-alikes as all candidates), match distance and poe.ninja value at the time. **Copy CSV** puts it on the clipboard as one row per gem:

```
logged_at,league,slot,gem,candidates,match_distance,chaos_at_log,plugin,refs
```

Gems logged before 0.4.1 lack the league, distance, price and version columns.

Rows marked **look-alike art** are gems whose icons are too alike to tell apart reliably. Both candidates and their prices are shown, so hover the gem in game to see which it is. Gems that can't reach level 20 (exceptional and Awakened supports, e.g. *Communion*, which shares *Minion Pact*'s art) are left out of recognition entirely, since a craft can't produce them, so most look-alikes never come up.

### Exceptional gem finder

Each craft also eats one exceptional support gem. Many sell for 1-10c, but on thin supply, so finding one seller with several is the hard part. The **Exceptional gem finder** section in the tab lists every exceptional support's cheapest uncorrupted poe.ninja line at or under **Max price** (10c by default), most listings first. **Trade** opens the trade site in your browser, searching that gem in Scalpel's configured league, uncorrupted, cheapest first (the search is in the link itself, so it costs no trade API request). **Choose** one to count its price in each craft's cost; its price refreshes whenever the finder reloads. The finder needs listing counts, which only the patched Scalpel (1.0.5-gems.12+) provides; poe.ninja's gem list is fetched when the section opens and cached for 30 minutes.

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

On synthetic renders at 720p-4K cell sizes, with up to 3px misalignment and ±20% brightness, `npm run sim` reports 100% correct, 0% wrong, 0.5% of correct matches shown with a look-alike alongside, and about 140ms per scan. Real captures still need confirming; tune `EMPTY_STDDEV` / `MATCH_MAX_DISTANCE` in `src/match.ts` if needed.
