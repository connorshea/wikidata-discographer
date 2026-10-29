import { useId } from "react";

/** A record, for the wordmark and the loading spinner. */
export default function RecordIcon({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  // Each copy needs its own gradient, or two on one page would share the first one's.
  const sheen = useId();
  return (
    <svg
      className={className ? `record-icon ${className}` : "record-icon"}
      width={size}
      height={size}
      viewBox="0 0 28 28"
      aria-hidden="true"
    >
      {/* Light catching the grooves. The stop colors are set per theme in the CSS. */}
      <defs>
        <linearGradient id={sheen} x1="0" y1="0" x2="1" y2="1">
          <stop className="sheen-hi" offset="0" />
          <stop className="sheen-mid" offset="0.45" />
          <stop className="sheen-mid" offset="0.55" />
          <stop className="sheen-lo" offset="1" />
        </linearGradient>
      </defs>
      <circle className="vinyl" cx="14" cy="14" r="13" fill={`url(#${sheen})`} />
      <circle className="groove" cx="14" cy="14" r="8.5" />
      <circle className="label" cx="14" cy="14" r="4.5" />
      <circle className="hole" cx="14" cy="14" r="1.4" />
    </svg>
  );
}
