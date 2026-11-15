import type { ReactElement } from "react";
import type { ConnView } from "./online-model";

/**
 * Connection-state glyph. The shape differs per state (ring, three dots, signal bars, check, cross), so state never
 * depends on colour alone. Inline SVG on a 16 px grid, drawn with fills and strokes on whole pixels.
 */
export function ConnGlyph({
  shape,
  className,
}: {
  readonly shape: ConnView["shape"];
  readonly className?: string;
}): ReactElement {
  return (
    <svg
      className={className}
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {shape === "ring" && <circle cx={8} cy={8} r={5} />}
      {shape === "dots" && (
        <g fill="currentColor" stroke="none">
          <circle cx={3} cy={8} r={1.75} />
          <circle cx={8} cy={8} r={1.75} />
          <circle cx={13} cy={8} r={1.75} />
        </g>
      )}
      {shape === "bars" && (
        <>
          <path d="M3 13V10" />
          <path d="M8 13V7" />
          <path d="M13 13V3" strokeDasharray="1 3" />
        </>
      )}
      {shape === "check" && <path d="M3 8.5l3.5 3.5L13 4.5" />}
      {shape === "cross" && <path d="M4 4l8 8M12 4l-8 8" />}
    </svg>
  );
}
