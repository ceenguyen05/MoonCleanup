import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EventBus, UiAction } from "@moon-cleanup/shared";
import { createUiStore } from "../../app/ui-store";
import { UiModule } from "../module";
import { UiProvider } from "../ui-context";
import { DotSubtitle } from "../onboarding/DotSubtitle";
import { CompassStrip } from "./CompassStrip";
import { ParcelsContext, type ParcelsStore } from "./parcels-store";

function wrap(store: ReturnType<typeof createUiStore>, parcels: ParcelsStore, child: React.ReactElement): string {
  store.flush(1000);
  const win = {
    matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }),
  };
  return renderToStaticMarkup(
    <UiProvider
      store={store}
      events={{} as EventBus}
      host={{} as HTMLElement}
      win={win as unknown as Window}
      motion="full"
      glass="auto"
    >
      <ParcelsContext.Provider value={parcels}>{child}</ParcelsContext.Provider>
    </UiProvider>,
  );
}

function moduleParcels(module: UiModule): ParcelsStore {
  return (module as unknown as { parcels: ParcelsStore }).parcels;
}

describe("UiModule.setMarkerBearing", () => {
  const store = createUiStore();
  const module = new UiModule({ store, win: {} as Window, search: "" });

  it("forwards to the parcels store (whole degrees, wrapped), change-only, and null removes", () => {
    const parcels = moduleParcels(module);
    let notified = 0;
    parcels.subscribe(() => notified++);
    module.setMarkerBearing("landing_apron", -10.2);
    expect(parcels.getState().markers).toEqual({ landing_apron: 350 });
    module.setMarkerBearing("landing_apron", 350.3);
    expect(notified).toBe(1);
    module.setMarkerBearing("landing_apron", null);
    expect(parcels.getState().markers).toEqual({});
    module.setMarkerBearing("landing_apron", null);
    expect(notified).toBe(2);
  });

  it("the compass draws a marker at its bearing with the catalog name, and skips unknown ids", () => {
    const parcels = moduleParcels(module);
    module.setMarkerBearing("assay_counter", 90);
    module.setMarkerBearing("not_a_place", 10);
    const html = wrap(createUiStore(), parcels, <CompassStrip />);
    expect(html).toContain('title="Objective: Assay Counter"');
    expect(html).not.toContain("not_a_place");
    expect(html.match(/Objective: Assay Counter/g)?.length).toBeGreaterThan(1); // repeated per track copy
    module.setMarkerBearing("assay_counter", null);
    module.setMarkerBearing("not_a_place", null);
  });
});

describe("unread Handbook tip badge", () => {
  const unread = (n: number): UiAction => ({ type: "dot.set", patch: { handbookUnread: n } });
  it("shows a text badge only while a tip is unread", () => {
    const parcels = moduleParcels(new UiModule({ store: createUiStore(), win: {} as Window, search: "" }));
    const withTip = createUiStore();
    withTip.dispatch(unread(1));
    expect(wrap(withTip, parcels, <DotSubtitle />)).toContain("New tip");
    expect(wrap(createUiStore(), parcels, <DotSubtitle />)).not.toContain("New tip");
  });
});
