// Every player-facing string of the ui module lives here (one module for later localisation). Names follow
// docs/design/naming-bible.md: Brightside Facilities Co., DOT, Lumens (LM), Shine, Dust Cell, Holster, Desk Duster.
// Nothing in this file names a reference-game term.

export const GAME_TITLE = "Clean The Moon!";

export const STRINGS = {
  waking: {
    headline: "Waking the moon…",
    headlineSlow: "The servers are taking longer than usual",
    headlineConnecting: "Joining the room…",
    headlineLost: "Lost contact with the moon",
    body: "Usually about a minute.",
    bodySlow: "Still working on it. Brightside appreciates your continued patience.",
    bodyConnecting: "The moon is awake. Finding you a spot on the shift.",
    bodyLost: "Your connection to the shift closed. Reload to try again.",
    reload: "Reload",
    elapsedLabel: "Elapsed",
    dotTag: "DOT",
    ariaDialog: "Connection status",
  },
  hud: {
    lumens: "LM",
    lumensLabel: "Lumens",
    shine: "Shine",
    holster: "Holster",
    cell: "Cell",
    lamp: "Lamp",
    visor: "Visor",
    hop: "Hop",
    compass: "Compass",
  },
  hudTest: {
    pageTitle: "HUD crispness bench",
    textSamples: "Text at native resolution",
    hairlines: "Hairlines (1 device px)",
    icons: "Icons",
    readout: "Display",
    dprLabel: "Device pixel ratio",
    hairlineLabel: "Hairline",
    scaleLabel: "HUD scale",
    glassLabel: "Glass",
    glassBlur: "Blur",
    glassSolid: "Solid",
    probeRun: "Measure glass cost",
    probeRunning: "Measuring…",
    probeNote: "Frame interval with four glass panels, with and without backdrop blur.",
    addIncome: "Add income",
    toastDemo: "Show a notice",
    sampleSentence: "Brightside keeps the bright side bright.",
    numerals: "0123456789",
    renderScaleLabel: "Render scale",
    devicepx: "device px",
    framesEach: "frames each",
  },
  items: {
    deskDuster: "Desk Duster",
    crescentSqueegee: "Crescent Squeegee",
  },
  toasts: {
    requisitionApproved: "Requisition approved",
    plotStamped: "Plot stamped",
    railshotAway: "Railshot away",
  },
  a11y: {
    uiRoot: "Game interface",
  },
} as const;

/** DOT lines shown while the moon wakes (rotate every 8 s; spec pool of 12). Dry corporate politeness. */
export const WAKING_DOT_TIPS = [
  "The Moon has been in standby to save power. Brightside thanks you for your patience and your lack of alternatives.",
  "Reminder: the Moon has no weather. Any dust you see is your fault now.",
  "Your Desk Duster has been polished for this occasion. It is very small. Please be kind to it.",
  "The slide deck promised this would take no time at all. The slide deck is under review.",
  "Please keep hands, feet and brooms inside the shuttle at all times. There is no shuttle. Keep them anyway.",
  "Hold music is currently unavailable. Imagine something upbeat.",
  "The servers are asleep. Brightside regrets nothing, but gently suggests a stretch.",
  "Dust that has been swept is still dust. It is simply dust that has been seen.",
  "Your uniform is machine washable. The Moon, sadly, is not.",
  "DOT confirms you are the best cleaner currently on the Moon. This is a very small sample.",
  "Sweeping is not a metaphor. It is the whole job.",
  "Almost there. This message was prepared in advance and is not a reliable indicator of anything.",
] as const;

/** Rotation interval of the DOT tips (ui-screens-and-flows SCR-03). */
export const WAKING_TIP_INTERVAL_S = 8;
