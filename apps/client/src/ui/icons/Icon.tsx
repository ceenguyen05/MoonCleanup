// Icon wrapper: inline SVG only (no icon font, no bitmap), 16/20/24/32 CSS px, one stroke weight at every size
// (1.75 px) so the visual weight stays constant (art-direction 8.5). Never sized with transform: scale().

import type { LucideIcon } from "lucide-react";
import type { ComponentType, ReactElement } from "react";
import type { CustomIconProps } from "./custom";

export type IconSize = 16 | 20 | 24 | 32;
export const ICON_STROKE_PX = 1.75;

export type IconComponent = LucideIcon | ((props: CustomIconProps) => ReactElement);

export interface IconProps {
  readonly icon: IconComponent;
  readonly size?: IconSize;
  /** Accessible name. Omit for decorative icons (they are hidden from assistive technology). */
  readonly label?: string;
  readonly className?: string;
}

export function Icon({ icon, size = 20, label, className }: IconProps): ReactElement {
  const Glyph = icon as ComponentType<CustomIconProps>;
  return (
    <Glyph
      size={size}
      strokeWidth={ICON_STROKE_PX}
      absoluteStrokeWidth
      {...(className === undefined ? {} : { className })}
      {...(label === undefined ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
    />
  );
}
