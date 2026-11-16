import { ArrowLeftRight, CloudCheck, CloudOff, CloudUpload, HardDrive, TriangleAlert } from "lucide-react";
import type { ReactElement } from "react";
import { Icon, type IconComponent, type IconSize } from "../icons/Icon";
import type { SyncGlyph as GlyphId } from "./save-sync-model";

/** One distinct silhouette per sync state (drive, cloud tick, cloud arrow, crossed cloud, swap arrows, warning). */
const GLYPHS: Readonly<Record<GlyphId, IconComponent>> = {
  device: HardDrive,
  cloud_ok: CloudCheck,
  cloud_up: CloudUpload,
  cloud_off: CloudOff,
  compare: ArrowLeftRight,
  alert: TriangleAlert,
};

export function SyncGlyph({ glyph, size = 16 }: { readonly glyph: GlyphId; readonly size?: IconSize }): ReactElement {
  return <Icon icon={GLYPHS[glyph]} size={size} />;
}
