// Headed Chrome for real-GPU timing, but off-screen and never throttled (no popups on the owner's desktop).
export const OFFSCREEN_CHROME_ARGS = [
  "--window-position=-32000,-32000",
  "--window-size=1280,720",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-background-timer-throttling",
];
