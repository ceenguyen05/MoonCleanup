import type { ReactElement } from "react";
import { HudTestPage } from "./hud-test/HudTestPage";
import { WakingOverlay } from "./screens/WakingOverlay";
import type { UiUrlOptions } from "./ui-options";

/** Everything the UI draws over the canvas. The HUD proper (M1) joins here; M0 has the waking overlay and the bench. */
export function UiRoot({ options }: { readonly options: UiUrlOptions }): ReactElement {
  return (
    <>
      {options.hudTest && <HudTestPage />}
      <WakingOverlay previewConn={options.wakePreview} />
    </>
  );
}
