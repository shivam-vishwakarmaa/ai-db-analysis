import React, { useState, useMemo, useRef, useCallback } from "react";

/**
 * Module 3 — RelationshipMapper
 * ==============================
 * Custom interactive SVG ER diagram with auto-layout.
 * Shows tables as styled boxes with PK/FK columns, relationship lines
 * with cardinality labels, zoom/pan, and click-to-highlight.
 *
 * @param {{ schemaJSON: object, onAIReady?: (narrative: object) => void }} props
 */
export default function RelationshipMapper({ schemaJSON, onAIReady }) {
  const [selectedTable, setSelectedTable] = useState(null);
  const [hoveredRel, setHoveredRel] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [showNarrative, setShowNarrative] = useState(false);
  const svgRef = useRef(null);

  const tables = schemaJSON?.tables || [];
  const relationships = schemaJSON?.relationships || [];

  // ── Role colors ────────────────────────────────────────

  const roleColors = {
    fact: {
      bg: "#1e3a5f",
      border: "#3b82f6",
      header: "#2563eb",
      text: "#93c5fd",
    },
    dimension: {
      bg: "#1a3a2a",
      border: "#10b981",
      header: "#059669",
      text: "#6ee7b7",
    },
    junction: {
      bg: "#3b2a1a",
      border: "#f59e0b",
      header: "#d97706",
      text: "#fcd34d",
    },
    isolated: {
      bg: "#2a2a2a",
      border: "#6b7280",
      header: "#4b5563",
      text: "#9ca3af",
    },
    unknown: {
      bg: "#2a2a2a",
      border: "#6b7280",
      header: "#4b5563",
      text: "#9ca3af",
    },
  };

  // ── Classify table role ────────────────────────────────

  function classifyRole(table) {
    const outFKs = (table.foreign_keys || []).length;
    const colCount = (table.columns || []).length;
    const isReferenced = tables.some(
      (t) =>
        t.name !== table.name &&
        (t.foreign_keys || []).some((fk) => fk.references_table === table.name),
    );
    if (outFKs === 0 && !isReferenced) return "isolated";
    if (outFKs === 2 && colCount <= outFKs + 2) return "junction";
    if (outFKs >= 2) return "fact";
    if (isReferenced) return "dimension";
    return "dimension";
  }

  // ── Auto-layout algorithm ──────────────────────────────
  // Place fact tables in center ring, dimensions on outer ring,
  // junctions between their parents, isolated on the edge.

  const layout = useMemo(() => {
    if (!tables.length) return {};

    const classified = tables.map((t) => ({ ...t, role: classifyRole(t) }));
    const facts = classified.filter((t) => t.role === "fact");
    const dims = classified.filter((t) => t.role === "dimension");
    const juncs = classified.filter((t) => t.role === "junction");
    const isos = classified.filter((t) => t.role === "isolated");

    // Node sizing
    const NODE_W = 200;
    const NODE_PAD = 60;

    // Estimate node height: header (36) + PK/FK rows (22 each) + padding
    function nodeHeight(t) {
      const pkSet = new Set(t.primary_keys || []);
      const fkSet = new Set((t.foreign_keys || []).map((f) => f.column));
      const keyCount = new Set([...pkSet, ...fkSet]).size;
      return 36 + Math.max(keyCount, 1) * 22 + 16;
    }

    const positions = {};

    // Center of canvas
    const cx = 500;
    const cy = 400;

    // Layout based on count
    if (tables.length <= 3) {
      // Simple horizontal layout
      classified.forEach((t, i) => {
        positions[t.name] = {
          x: 100 + i * (NODE_W + NODE_PAD),
          y: cy - nodeHeight(t) / 2,
          w: NODE_W,
          h: nodeHeight(t),
          role: t.role,
        };
      });
    } else {
      // Radial layout: facts in center, dimensions on outer ring
      const innerRadius = Math.max(180, facts.length * 60);
      const outerRadius = innerRadius + 250;

      // Place fact tables in inner circle
      facts.forEach((t, i) => {
        const angle =
          (2 * Math.PI * i) / Math.max(facts.length, 1) - Math.PI / 2;
        const x =
          cx +
          Math.cos(angle) * (facts.length === 1 ? 0 : innerRadius) -
          NODE_W / 2;
        const y =
          cy +
          Math.sin(angle) * (facts.length === 1 ? 0 : innerRadius) -
          nodeHeight(t) / 2;
        positions[t.name] = { x, y, w: NODE_W, h: nodeHeight(t), role: t.role };
      });

      // Place dimension tables on outer ring
      dims.forEach((t, i) => {
        const angle = (2 * Math.PI * i) / Math.max(dims.length, 1) - Math.PI / 2;
        const x = cx + Math.cos(angle) * outerRadius - NODE_W / 2;
        const y = cy + Math.sin(angle) * outerRadius - nodeHeight(t) / 2;
        positions[t.name] = { x, y, w: NODE_W, h: nodeHeight(t), role: t.role };
      });

      // Place junction tables between their linked parents
      juncs.forEach((t, i) => {
        const fks = t.foreign_keys || [];
        if (
          fks.length >= 2 &&
          positions[fks[0].references_table] &&
          positions[fks[1].references_table]
        ) {
          const p1 = positions[fks[0].references_table];
          const p2 = positions[fks[1].references_table];
          positions[t.name] = {
            x: (p1.x + p2.x) / 2,
            y: (p1.y + p2.y) / 2 + 80,
            w: NODE_W,
            h: nodeHeight(t),
            role: t.role,
          };
        } else {
          const angle = (2 * Math.PI * i) / Math.max(juncs.length, 1);
          positions[t.name] = {
            x: cx + Math.cos(angle) * (innerRadius + 100) - NODE_W / 2,
            y: cy + Math.sin(angle) * (innerRadius + 100) - nodeHeight(t) / 2,
            w: NODE_W,
            h: nodeHeight(t),
            role: t.role,
          };
        }
      });

      // Place isolated tables on far edge
      isos.forEach((t, i) => {
        positions[t.name] = {
          x: 50 + i * (NODE_W + 40),
          y: cy + outerRadius + 120,
          w: NODE_W,
          h: nodeHeight(t),
          role: t.role,
        };
      });
    }

    return positions;
  }, [tables]);

  // ── Compute SVG viewBox to fit all nodes ───────────────

  const viewBox = useMemo(() => {
    const positions = Object.values(layout);
    if (!positions.length) return "0 0 1000 800";
    const minX = Math.min(...positions.map((p) => p.x)) - 60;
    const minY = Math.min(...positions.map((p) => p.y)) - 60;
    const maxX = Math.max(...positions.map((p) => p.x + p.w)) + 60;
    const maxY = Math.max(...positions.map((p) => p.y + p.h)) + 60;
    return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
  }, [layout]);

  // ── Get connected tables ───────────────────────────────

  const connectedTables = useMemo(() => {
    if (!selectedTable) return new Set();
    const connected = new Set();
    relationships.forEach((r) => {
      if (r.from_table === selectedTable) connected.add(r.to_table);
      if (r.to_table === selectedTable) connected.add(r.from_table);
    });
    return connected;
  }, [selectedTable, relationships]);

  // ── Edge path calculation ──────────────────────────────

  function getEdgePath(fromPos, toPos) {
    const x1 = fromPos.x + fromPos.w / 2;
    const y1 = fromPos.y + fromPos.h / 2;
    const x2 = toPos.x + toPos.w / 2;
    const y2 = toPos.y + toPos.h / 2;

    // Find the best connection points (nearest edges)
    const fromPt = getConnectionPoint(fromPos, x2, y2);
    const toPt = getConnectionPoint(toPos, x1, y1);

    // Curved path
    const mx = (fromPt.x + toPt.x) / 2;
    const my = (fromPt.y + toPt.y) / 2;
    const dx = toPt.x - fromPt.x;
    const dy = toPt.y - fromPt.y;
    const offset = Math.min(Math.abs(dx), Math.abs(dy)) * 0.3;
    const cx1 =
      fromPt.x + (Math.abs(dy) > Math.abs(dx) ? offset * Math.sign(dx || 1) : 0);
    const cy1 =
      fromPt.y +
      (Math.abs(dx) >= Math.abs(dy) ? offset * Math.sign(dy || 1) : 0);

    return {
      path: `M ${fromPt.x} ${fromPt.y} Q ${cx1} ${cy1} ${mx} ${my} T ${toPt.x} ${toPt.y}`,
      labelPos: { x: mx, y: my },
      fromPt,
      toPt,
    };
  }

  function getConnectionPoint(box, targetX, targetY) {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const dx = targetX - cx;
    const dy = targetY - cy;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (absDx * box.h > absDy * box.w) {
      // Exit from left or right
      const side = dx > 0 ? box.x + box.w : box.x;
      const yy = cy + (dy / absDx) * (box.w / 2);
      return { x: side, y: Math.max(box.y, Math.min(box.y + box.h, yy)) };
    } else {
      // Exit from top or bottom
      const side = dy > 0 ? box.y + box.h : box.y;
      const xx = cx + (dx / Math.max(absDy, 1)) * (box.h / 2);
      return { x: Math.max(box.x, Math.min(box.x + box.w, xx)), y: side };
    }
  }

  // ── Cardinality symbols ────────────────────────────────

  function cardinalityLabel(card) {
    switch (card) {
      case "one-to-one":
        return "1 : 1";
      case "one-to-many":
        return "1 : N";
      case "many-to-many":
        return "M : N";
      case "many-to-one":
        return "N : 1";
      default:
        return "1 : N";
    }
  }

  // ── Zoom & pan handlers ────────────────────────────────

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.3, Math.min(3, z - e.deltaY * 0.001)));
  }, []);

  const handleMouseDown = useCallback(
    (e) => {
      if (
        e.target === svgRef.current ||
        e.target.tagName === "svg" ||
        e.target.closest(".pan-area")
      ) {
        setIsPanning(true);
        setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      }
    },
    [pan],
  );

  const handleMouseMove = useCallback(
    (e) => {
      if (isPanning) {
        setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
      }
    },
    [isPanning, panStart],
  );

  const handleMouseUp = useCallback(() => setIsPanning(false), []);

  // ── Export SVG ─────────────────────────────────────────

  const exportSVG = useCallback(() => {
    if (!svgRef.current) return;
    const svgData = new XMLSerializer().serializeToString(svgRef.current);
    const blob = new Blob([svgData], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${schemaJSON?.metadata?.database_name || "er_diagram"}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [schemaJSON]);

  // ── Render ─────────────────────────────────────────────

  if (!tables.length) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <p className="text-gray-500 text-lg">No schema data to visualise.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white flex flex-col">
      {/* ── Header ── */}
      <div className="p-4 border-b border-gray-700/50 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-400">
              ER Diagram
            </span>
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            {tables.length} tables · {relationships.length} relationships
            {selectedTable && (
              <span className="text-cyan-400"> · Selected: {selectedTable}</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Zoom controls */}
          <button
            onClick={() => setZoom((z) => Math.min(3, z + 0.2))}
            className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs transition-colors"
          >
            +
          </button>
          <span className="text-xs text-gray-400 w-12 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.max(0.3, z - 0.2))}
            className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs transition-colors"
          >
            −
          </button>
          <button
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs transition-colors ml-1"
          >
            Reset
          </button>

          <div className="w-px h-6 bg-gray-700 mx-2" />

          {/* Narrative toggle */}
          <button
            onClick={() => setShowNarrative(!showNarrative)}
            className={`px-3 py-1 rounded text-xs transition-colors ${
              showNarrative
                ? "bg-purple-600 text-white"
                : "bg-gray-700 hover:bg-gray-600 text-gray-300"
            }`}
          >
            {showNarrative ? "✦ Narrative" : "✦ Narrative"}
          </button>

          {/* Export */}
          <button
            onClick={exportSVG}
            className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-xs transition-colors"
          >
            ⬇ Export SVG
          </button>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── SVG Canvas ── */}
        <div
          className="flex-1 overflow-hidden cursor-grab active:cursor-grabbing"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <svg
            ref={svgRef}
            viewBox={viewBox}
            className="w-full h-full pan-area"
            style={{
              transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
            }}
          >
            <defs>
              {/* Arrow marker */}
              <marker
                id="arrow"
                viewBox="0 0 10 7"
                refX="10"
                refY="3.5"
                markerWidth="8"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <polygon points="0 0, 10 3.5, 0 7" fill="#60a5fa" />
              </marker>
              <marker
                id="arrow-dim"
                viewBox="0 0 10 7"
                refX="10"
                refY="3.5"
                markerWidth="8"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <polygon points="0 0, 10 3.5, 0 7" fill="#6b7280" />
              </marker>
              {/* Glow filter */}
              <filter id="glow">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* ── Relationship lines ── */}
            {relationships.map((rel, i) => {
              const fromPos = layout[rel.from_table];
              const toPos = layout[rel.to_table];
              if (!fromPos || !toPos) return null;

              const { path, labelPos } = getEdgePath(fromPos, toPos);
              const isHighlighted =
                selectedTable === rel.from_table ||
                selectedTable === rel.to_table;
              const isHovered = hoveredRel === i;
              const isDimmed = selectedTable && !isHighlighted;

              return (
                <g
                  key={i}
                  onMouseEnter={() => setHoveredRel(i)}
                  onMouseLeave={() => setHoveredRel(null)}
                  style={{ cursor: "pointer" }}
                >
                  {/* Path line */}
                  <path
                    d={path}
                    fill="none"
                    stroke={
                      isHighlighted ? "#60a5fa" : isDimmed ? "#374151" : "#4b5563"
                    }
                    strokeWidth={isHighlighted || isHovered ? 2.5 : 1.5}
                    strokeDasharray={rel.inferred ? "6 4" : "none"}
                    markerEnd={`url(#${isDimmed ? "arrow-dim" : "arrow"})`}
                    style={{
                      transition: "stroke 0.2s, stroke-width 0.2s",
                      filter: isHighlighted ? "url(#glow)" : "none",
                    }}
                  />

                  {/* Cardinality label */}
                  <g transform={`translate(${labelPos.x}, ${labelPos.y})`}>
                    <rect
                      x={-24}
                      y={-10}
                      width={48}
                      height={20}
                      rx={4}
                      fill={isHighlighted ? "#1e3a5f" : "#1f2937"}
                      stroke={isHighlighted ? "#3b82f6" : "#374151"}
                      strokeWidth={0.5}
                      opacity={isDimmed ? 0.3 : 0.9}
                    />
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={9}
                      fontFamily="monospace"
                      fill={
                        isHighlighted
                          ? "#93c5fd"
                          : isDimmed
                            ? "#4b5563"
                            : "#9ca3af"
                      }
                    >
                      {cardinalityLabel(rel.cardinality)}
                    </text>
                  </g>

                  {/* Hover tooltip */}
                  {isHovered && (
                    <g
                      transform={`translate(${labelPos.x}, ${labelPos.y - 28})`}
                    >
                      <rect
                        x={-90}
                        y={-14}
                        width={180}
                        height={28}
                        rx={6}
                        fill="#111827"
                        stroke="#374151"
                        strokeWidth={1}
                      />
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={10}
                        fill="#d1d5db"
                        fontFamily="sans-serif"
                      >
                        {rel.from_table}.{rel.from_column} → {rel.to_table}.
                        {rel.to_column}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* ── Table nodes ── */}
            {tables.map((tbl) => {
              const pos = layout[tbl.name];
              if (!pos) return null;

              const role = pos.role || "unknown";
              const colors = roleColors[role] || roleColors.unknown;
              const isSelected = selectedTable === tbl.name;
              const isConnected = connectedTables.has(tbl.name);
              const isDimmed = selectedTable && !isSelected && !isConnected;

              const pkSet = new Set(tbl.primary_keys || []);
              const fkSet = new Set((tbl.foreign_keys || []).map((f) => f.column));
              const keyCols = (tbl.columns || []).filter(
                (c) => pkSet.has(c.name) || fkSet.has(c.name),
              );

              return (
                <g
                  key={tbl.name}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  onClick={() =>
                    setSelectedTable(
                      selectedTable === tbl.name ? null : tbl.name,
                    )
                  }
                  style={{
                    cursor: "pointer",
                    opacity: isDimmed ? 0.25 : 1,
                    transition: "opacity 0.25s",
                  }}
                >
                  {/* Selection glow */}
                  {isSelected && (
                    <rect
                      x={-3}
                      y={-3}
                      width={pos.w + 6}
                      height={pos.h + 6}
                      rx={12}
                      fill="none"
                      stroke={colors.border}
                      strokeWidth={2}
                      filter="url(#glow)"
                    />
                  )}

                  {/* Card background */}
                  <rect
                    width={pos.w}
                    height={pos.h}
                    rx={8}
                    fill={colors.bg}
                    stroke={colors.border}
                    strokeWidth={isSelected ? 2 : 1}
                  />

                  {/* Header */}
                  <rect width={pos.w} height={36} rx={8} fill={colors.header} />
                  <rect
                    x={0}
                    y={28}
                    width={pos.w}
                    height={8}
                    fill={colors.header}
                  />

                  {/* Table name */}
                  <text
                    x={pos.w / 2}
                    y={22}
                    textAnchor="middle"
                    fontSize={12}
                    fontWeight="bold"
                    fill="white"
                    fontFamily="sans-serif"
                  >
                    {tbl.name.length > 22
                      ? tbl.name.slice(0, 20) + "…"
                      : tbl.name}
                  </text>

                  {/* Row count badge */}
                  <text
                    x={pos.w - 8}
                    y={22}
                    textAnchor="end"
                    fontSize={8}
                    fill="rgba(255,255,255,0.5)"
                    fontFamily="monospace"
                  >
                    {tbl.row_count?.toLocaleString()}
                  </text>

                  {/* PK & FK columns */}
                  {keyCols.map((col, ci) => {
                    const isPK = pkSet.has(col.name);
                    const isFK = fkSet.has(col.name);
                    const yy = 36 + 8 + ci * 22;
                    return (
                      <g key={col.name} transform={`translate(0, ${yy})`}>
                        {/* Key icon */}
                        <text x={12} y={0} dominantBaseline="central" fontSize={10}>
                          {isPK ? "🔑" : "🔗"}
                        </text>
                        {/* Column name */}
                        <text
                          x={28}
                          y={0}
                          dominantBaseline="central"
                          fontSize={10}
                          fill={colors.text}
                          fontFamily="monospace"
                        >
                          {col.name.length > 20
                            ? col.name.slice(0, 18) + "…"
                            : col.name}
                        </text>
                        {/* Type */}
                        <text
                          x={pos.w - 8}
                          y={0}
                          textAnchor="end"
                          dominantBaseline="central"
                          fontSize={8}
                          fill="rgba(255,255,255,0.3)"
                          fontFamily="monospace"
                        >
                          {col.type}
                        </text>
                        {/* PK / FK badge */}
                        <rect
                          x={pos.w - 40}
                          y={-7}
                          width={24}
                          height={14}
                          rx={3}
                          fill={
                            isPK
                              ? "rgba(59,130,246,0.2)"
                              : "rgba(16,185,129,0.2)"
                          }
                          stroke={
                            isPK
                              ? "rgba(59,130,246,0.3)"
                              : "rgba(16,185,129,0.3)"
                          }
                          strokeWidth={0.5}
                        />
                        <text
                          x={pos.w - 28}
                          y={0}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontSize={7}
                          fill={isPK ? "#93c5fd" : "#6ee7b7"}
                          fontWeight="600"
                          fontFamily="sans-serif"
                        >
                          {isPK && isFK ? "PFK" : isPK ? "PK" : "FK"}
                        </text>
                      </g>
                    );
                  })}

                  {/* No keys indicator */}
                  {keyCols.length === 0 && (
                    <text
                      x={pos.w / 2}
                      y={52}
                      textAnchor="middle"
                      fontSize={10}
                      fill="#6b7280"
                      fontStyle="italic"
                    >
                      No keys defined
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        {/* ── Side panel (when table selected or narrative shown) ── */}
        {(selectedTable || showNarrative) && (
          <aside className="w-80 min-w-[320px] border-l border-gray-700/50 bg-gray-900/60 overflow-y-auto p-4 space-y-4">
            {selectedTable &&
              (() => {
                const tbl = tables.find((t) => t.name === selectedTable);
                if (!tbl) return null;
                const role = classifyRole(tbl);
                const colors = roleColors[role] || roleColors.unknown;
                const outgoing = relationships.filter(
                  (r) => r.from_table === tbl.name,
                );
                const incoming = relationships.filter(
                  (r) => r.to_table === tbl.name,
                );

                return (
                  <>
                    {/* Table info header */}
                    <div>
                      <h3 className="text-lg font-bold text-white">
                        {tbl.name}
                      </h3>
                      <div className="flex gap-2 mt-2">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border`}
                          style={{
                            backgroundColor: colors.bg,
                            borderColor: colors.border,
                            color: colors.text,
                          }}
                        >
                          {role}
                        </span>
                        <span className="text-xs text-gray-400">
                          {tbl.row_count?.toLocaleString()} rows
                        </span>
                        <span className="text-xs text-gray-400">
                          {tbl.columns?.length} cols
                        </span>
                      </div>
                    </div>

                    {/* All columns */}
                    <div className="rounded-lg border border-gray-700/50 overflow-hidden">
                      <div className="px-3 py-2 bg-gray-800/60 border-b border-gray-700/50">
                        <h4 className="text-xs font-semibold text-gray-400 uppercase">
                          All Columns
                        </h4>
                      </div>
                      <div className="divide-y divide-gray-800/50">
                        {(tbl.columns || []).map((col) => {
                          const isPK = (tbl.primary_keys || []).includes(
                            col.name,
                          );
                          const fk = (tbl.foreign_keys || []).find(
                            (f) => f.column === col.name,
                          );
                          return (
                            <div
                              key={col.name}
                              className="px-3 py-1.5 flex items-center gap-2 text-xs"
                            >
                              <span className="w-3">
                                {isPK ? "🔑" : fk ? "🔗" : ""}
                              </span>
                              <span className="text-gray-200 font-mono flex-1 truncate">
                                {col.name}
                              </span>
                              <span className="text-gray-500 font-mono">
                                {col.type}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Outgoing relationships */}
                    {outgoing.length > 0 && (
                      <div className="rounded-lg border border-gray-700/50 overflow-hidden">
                        <div className="px-3 py-2 bg-gray-800/60 border-b border-gray-700/50">
                          <h4 className="text-xs font-semibold text-gray-400 uppercase">
                            Outgoing FKs ({outgoing.length})
                          </h4>
                        </div>
                        <div className="p-3 space-y-1.5">
                          {outgoing.map((r, i) => (
                            <div key={i} className="text-xs text-gray-300">
                              <span className="font-mono text-blue-400">
                                {r.from_column}
                              </span>
                              <span className="text-gray-500"> → </span>
                              <span className="font-mono text-emerald-400">
                                {r.to_table}.{r.to_column}
                              </span>
                              <span
                                className={`ml-1.5 px-1 py-0.5 rounded text-[9px] ${
                                  r.inferred
                                    ? "bg-yellow-500/15 text-yellow-400"
                                    : "bg-emerald-500/15 text-emerald-400"
                                }`}
                              >
                                {r.inferred ? "INF" : "EXP"}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Incoming relationships */}
                    {incoming.length > 0 && (
                      <div className="rounded-lg border border-gray-700/50 overflow-hidden">
                        <div className="px-3 py-2 bg-gray-800/60 border-b border-gray-700/50">
                          <h4 className="text-xs font-semibold text-gray-400 uppercase">
                            Referenced by ({incoming.length})
                          </h4>
                        </div>
                        <div className="p-3 space-y-1.5">
                          {incoming.map((r, i) => (
                            <div key={i} className="text-xs text-gray-300">
                              <span className="font-mono text-cyan-400">
                                {r.from_table}.{r.from_column}
                              </span>
                              <span className="text-gray-500">
                                {" "}
                                → this.{r.to_column}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <button
                      onClick={() => setSelectedTable(null)}
                      className="w-full py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs text-gray-400 transition-colors"
                    >
                      Deselect
                    </button>
                  </>
                );
              })()}
          </aside>
        )}
      </div>

      {/* ── Legend bar ── */}
      <div className="border-t border-gray-700/50 bg-gray-900/60 px-5 py-2.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-center gap-5 text-xs text-gray-400">
          {Object.entries(roleColors)
            .filter(([k]) => k !== "unknown")
            .map(([role, c]) => (
              <span key={role} className="flex items-center gap-1.5">
                <span
                  className="w-3 h-3 rounded-sm"
                  style={{ backgroundColor: c.header, border: `1px solid ${c.border}` }}
                />
                <span className="capitalize">{role}</span>
              </span>
            ))}
          <span className="text-gray-700">|</span>
          <span className="flex items-center gap-1.5">
            <span className="w-6 border-t-2 border-gray-400" /> Explicit FK
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-6 border-t-2 border-dashed border-gray-400" />{" "}
            Inferred FK
          </span>
          <span className="text-gray-700">|</span>
          <span>
            Click table to highlight connections · Scroll to zoom · Drag to pan
          </span>
        </div>
      </div>
    </div>
  );
}
