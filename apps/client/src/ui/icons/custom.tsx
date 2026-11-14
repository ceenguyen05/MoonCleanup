// Custom glyphs on the Lucide grid (24 px viewBox, round caps and joins). Authored for this project (LicenseRef-Original).
// They take the same props as Lucide icons so `Icon` can render either kind.

import type { ReactElement, SVGProps } from "react";

export interface CustomIconProps extends Omit<SVGProps<SVGSVGElement>, "ref" | "children"> {
  readonly size?: number | string;
  readonly strokeWidth?: number | string;
  readonly absoluteStrokeWidth?: boolean;
}

/** Strips the Lucide-only prop and applies the shared SVG attributes. */
function Svg(props: CustomIconProps & { readonly children: ReactElement | ReactElement[] }): ReactElement {
  const { size = 24, strokeWidth = 1.75, absoluteStrokeWidth = false, children, ...rest } = props;
  const px = Number(size);
  const stroke = absoluteStrokeWidth ? (Number(strokeWidth) * 24) / px : strokeWidth;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={rest["aria-label"] === undefined ? true : undefined}
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Lumens (LM): a sunburst, eight rays around a core. */
export function LumenIcon(props: CustomIconProps): ReactElement {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" />
    </Svg>
  );
}

/** Dust Cell: a rounded canister with a fill line and a cap. */
export function DustCellIcon(props: CustomIconProps): ReactElement {
  return (
    <Svg {...props}>
      <path d="M9 3h6" />
      <rect x="6.5" y="5" width="11" height="16" rx="3" />
      <path d="M6.5 13.5h11" />
      <path d="M10 17.2h4" />
    </Svg>
  );
}

/** Plot hex: one hexagonal plot with a polish shine mark. */
export function PlotHexIcon(props: CustomIconProps): ReactElement {
  return (
    <Svg {...props}>
      <path d="M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4z" />
      <path d="M9 12.5l2.2 2.2L15.5 10" />
    </Svg>
  );
}

/** Shine: a four-point sparkle over a ring. */
export function ShineIcon(props: CustomIconProps): ReactElement {
  return (
    <Svg {...props}>
      <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" />
      <path d="M19 16.5v3M17.5 18h3" />
    </Svg>
  );
}
