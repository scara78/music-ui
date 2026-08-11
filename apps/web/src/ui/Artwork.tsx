import type { CSSProperties } from "react";
import type { Generation } from "@contracts";
import { generationHue } from "../lib/format";

export function Artwork(
  { generation, compact = false }: {
    generation: Generation;
    compact?: boolean;
  },
) {
  const style = { "--art-hue": generationHue(generation) } as CSSProperties;
  return (
    <div
      className={`artwork ${compact ? "artwork--compact" : ""}`}
      style={style}
      aria-hidden="true"
    >
      <span className="artwork__orb" />
      <span className="artwork__wave">
        {Array.from({ length: 9 }, (_, index) => <i key={index} />)}
      </span>
    </div>
  );
}
