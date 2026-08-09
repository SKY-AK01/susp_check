/**
 * GT vs. student overlay renderer — §6.8, FR-8.1–8.3.
 * Renders shapes as SVG overlays on top of the image.
 * Colors: reference = blue, student = orange, diff highlights per verdict.
 * Attribute mismatches shown as inline badges on the relevant shape.
 */
import { useEffect, useRef, useState } from "react";
import { ShapeData, ShapeDiff, Verdict } from "../../api/client";

interface BoxGeometry { xtl: number; ytl: number; xbr: number; ybr: number }
interface PolygonGeometry { points: [number, number][] }

const VERDICT_COLORS: Record<Verdict, string> = {
  exact_match:            "#22c55e",
  minor_difference:       "#facc15",
  significant_difference: "#f97316",
  missing:                "#ef4444",
  extra:                  "#a855f7",
  needs_manual_review:    "#94a3b8",
};

interface Props {
  imageUrl?: string;
  shapes: ShapeData[];
  source: "reference" | "student";
  shapeDiffs: ShapeDiff[];  // used to look up per-shape verdict for highlight colour
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
}

export default function OverlayCanvas({
  imageUrl,
  shapes,
  source,
  shapeDiffs,
  width,
  height,
  naturalWidth,
  naturalHeight,
}: Props) {
  // Build a map from shape_id → verdict for highlight colours
  const verdictByShapeId: Record<string, Verdict> = {};
  for (const diff of shapeDiffs) {
    if (source === "reference" && diff.reference_shape_id) {
      verdictByShapeId[diff.reference_shape_id] = diff.verdict;
    }
    if (source === "student" && diff.student_shape_id) {
      verdictByShapeId[diff.student_shape_id] = diff.verdict;
    }
  }

  // Scale factors: natural image size → display size
  const scaleX = naturalWidth > 0 ? width / naturalWidth : 1;
  const scaleY = naturalHeight > 0 ? height / naturalHeight : 1;

  function shapeToSvg(s: ShapeData): React.ReactNode {
    const verdict = verdictByShapeId[s.id];
    const baseColor = source === "reference" ? "#3b82f6" : "#fb923c";
    const strokeColor = verdict ? VERDICT_COLORS[verdict] : baseColor;
    const fillColor = strokeColor + "22"; // low-opacity fill

    if (s.geometry_invalid) {
      return null; // don't render invalid geometry
    }

    if (s.type === "box") {
      const g = s.geometry as unknown as BoxGeometry;
      const x = g.xtl * scaleX;
      const y = g.ytl * scaleY;
      const w = (g.xbr - g.xtl) * scaleX;
      const h = (g.ybr - g.ytl) * scaleY;
      return (
        <g key={s.id}>
          <rect
            x={x} y={y} width={w} height={h}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={1.5}
          />
          {s.label_name && (
            <text x={x + 2} y={y - 3} fontSize={9} fill={strokeColor} fontFamily="monospace">
              {s.label_name}
            </text>
          )}
          {/* Attribute diff badges */}
          {renderAttrBadges(s, verdict, x, y + h)}
        </g>
      );
    }

    if (s.type === "polygon") {
      const g = s.geometry as unknown as PolygonGeometry;
      const points = g.points
        .map(([px, py]) => `${px * scaleX},${py * scaleY}`)
        .join(" ");
      // Centroid for label
      const cx = g.points.reduce((sum, [px]) => sum + px, 0) / g.points.length * scaleX;
      const cy = g.points.reduce((sum, [, py]) => sum + py, 0) / g.points.length * scaleY;
      return (
        <g key={s.id}>
          <polygon
            points={points}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={1.5}
          />
          {s.label_name && (
            <text x={cx} y={cy} fontSize={9} fill={strokeColor} fontFamily="monospace"
              textAnchor="middle" dominantBaseline="middle">
              {s.label_name}
            </text>
          )}
        </g>
      );
    }

    return null;
  }

  function renderAttrBadges(s: ShapeData, verdict: Verdict | undefined, x: number, y: number) {
    // Find attribute diffs for this shape from shapeDiffs
    const diff = shapeDiffs.find(
      (d) => d.student_shape_id === s.id || d.reference_shape_id === s.id
    );
    if (!diff?.attribute_diffs?.length) return null;

    return diff.attribute_diffs
      .filter((a) => a.verdict !== "exact_match")
      .map((a, i) => (
        <g key={a.name}>
          <rect
            x={x} y={y + i * 12}
            width={Math.min(120, a.name.length * 6 + 40)} height={11}
            fill="#1e293b" stroke={VERDICT_COLORS[a.verdict as Verdict]} strokeWidth={0.8} rx={2}
          />
          <text x={x + 2} y={y + i * 12 + 8.5} fontSize={7.5} fill="#e2e8f0" fontFamily="monospace">
            {a.name}: {a.student_value ?? "—"}
          </text>
        </g>
      ));
  }

  return (
    <div className="relative" style={{ width, height }}>
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={source}
          style={{ width, height, objectFit: "contain", display: "block" }}
        />
      ) : (
        <div
          className="bg-neo-bg border-2 border-black flex items-center justify-center text-gray-500 text-xs font-bold"
          style={{ width, height }}
        >
          No image
        </div>
      )}
      <svg
        className="absolute inset-0 pointer-events-none"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
      >
        {shapes.map((s) => shapeToSvg(s))}
      </svg>
    </div>
  );
}
