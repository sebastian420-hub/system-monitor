# System Monitor

A tiny menu-bar app that shows CPU, GPU or RAM usage (pick one for the menu bar; click for all three plus system info). Built with Electron, no runtime dependencies.

```
npm install
npm start      # run
npm test       # unit tests for the parsing/formatting helpers
npm run dist   # build a macOS dmg/zip (run on a Mac)
```

Right-click the menu-bar item to quit.

## Platforms
macOS is the supported target. GPU usage (`ioreg`), swap and the Activity-Monitor-style RAM figure (`vm_stat`) are macOS only. On Linux/Windows the app runs, RAM uses `os.freemem()`, and GPU shows N/A.

## Low-power design
- Only the metric you are looking at is sampled: the selected one while the popup is closed, all of them while it is open.
- Sampling is every 3 s (5 s on battery) while closed and 1.5 s while open. It pauses on sleep and screen lock.
- Stats come from `os` and single `vm_stat` / narrow `ioreg` calls run without a shell.
- The popup window is created on first click and destroyed 60 s after it is hidden, so no renderer process idles in the background.
- Hardware acceleration is disabled; the UI is plain DOM with compositor-only bar animations.
