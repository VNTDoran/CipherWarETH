"use client";

import { useEffect, useRef, useState } from "react";
import { AGENCY_META } from "../../../shared/constants";
import type { MatchView, MessengerView } from "../../../shared/types";

/**
 * The shared map. Four agencies sit at the corners and transmit to capitals on
 * the far side, so every route bows through the centre — which is the whole
 * point: no message is ever out of anyone's reach.
 *
 * Positions are interpolated on the client from `dispatchedAt`/`arrivesAt`, so
 * the server never sends coordinates. It sends two timestamps per courier and
 * the animation stays smooth at any tick rate.
 */

interface Route {
  from: [number, number];
  to: [number, number];
  ctrl: [number, number];
}

/**
 * Control points are chosen so the four midpoints land well apart — roughly
 * (50,24), (71,49), (29,57), (50,77). All four still run through the central
 * zone, but four simultaneous dispatches no longer stack on the same pixel.
 */
const ROUTES: Route[] = [
  { from: [12, 13], to: [88, 64], ctrl: [50, 10] }, // slot 0 — NORD, bows up
  { from: [88, 13], to: [12, 64], ctrl: [92, 60] }, // slot 1 — EST, bows right
  { from: [12, 87], to: [88, 36], ctrl: [8, 52] },  // slot 2 — SUD, bows left
  { from: [88, 87], to: [12, 36], ctrl: [50, 92] }, // slot 3 — OUEST, bows down
];

function ambientRoute(id: string): Route {
  // Deterministic per-messenger so the courier doesn't jump between frames.
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const y = 22 + (h % 56);
  const flip = (h >> 8) % 2 === 0;
  return flip
    ? { from: [-4, y], to: [104, 100 - y], ctrl: [50, 50] }
    : { from: [104, y], to: [-4, 100 - y], ctrl: [50, 50] };
}

function pointAt(r: Route, t: number): [number, number] {
  const u = 1 - t;
  return [
    u * u * r.from[0] + 2 * u * t * r.ctrl[0] + t * t * r.to[0],
    u * u * r.from[1] + 2 * u * t * r.ctrl[1] + t * t * r.to[1],
  ];
}

function routeFor(m: MessengerView): Route {
  return m.ownerSlot === null ? ambientRoute(m.id) : ROUTES[m.ownerSlot] ?? ROUTES[0];
}

function pathD(r: Route): string {
  return `M ${r.from[0]} ${r.from[1]} Q ${r.ctrl[0]} ${r.ctrl[1]} ${r.to[0]} ${r.to[1]}`;
}

export default function Ether({
  view,
  selectedId,
  onSelect,
}: {
  view: MatchView;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  // Local clock so couriers glide between the server's 2 Hz snapshots.
  const [now, setNow] = useState(() => Date.now());
  const raf = useRef<number>(0);

  useEffect(() => {
    const loop = () => {
      setNow(Date.now());
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  const colorOf = (slot: number | null) => {
    if (slot === null) return "#64748b";
    const p = view.players.find((x) => x.slot === slot);
    return p ? AGENCY_META[p.agency].color : "#64748b";
  };

  return (
    <div className="relative h-full w-full">
      <svg viewBox="0 0 100 100" className="h-full w-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="etherGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#5cc9fc" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle cx="50" cy="50" r="34" fill="url(#etherGlow)" />
        <circle
          cx="50"
          cy="50"
          r="26"
          fill="none"
          stroke="rgba(203,213,225,0.3)"
          strokeWidth="0.25"
          strokeDasharray="1.5 2"
        />
        <text
          x="50"
          y="51"
          textAnchor="middle"
          className="font-mono"
          fontSize="2.6"
          letterSpacing="1.6"
          fill="rgba(203,213,225,0.45)"
        >
          ETHER
        </text>

        {/* Agency nodes and their routes */}
        {view.players.map((p) => {
          const r = ROUTES[p.slot];
          if (!r) return null;
          const color = AGENCY_META[p.agency].color;
          return (
            <g key={p.slot}>
              <path
                d={pathD(r)}
                fill="none"
                stroke={color}
                strokeOpacity={0.3}
                strokeWidth="0.35"
                strokeDasharray="2 2.5"
              />
              <circle cx={r.from[0]} cy={r.from[1]} r="2.4" fill={color} fillOpacity={0.9} />
              <circle
                cx={r.from[0]}
                cy={r.from[1]}
                r="3.6"
                fill="none"
                stroke={color}
                strokeOpacity={0.6}
                strokeWidth="0.3"
              />
              <text
                x={r.from[0]}
                y={r.from[1] + 0.9}
                textAnchor="middle"
                fontSize="2.4"
                fill="#05070c"
                className="font-mono font-bold"
              >
                {AGENCY_META[p.agency].sigil}
              </text>
              {/* Capital */}
              <rect
                x={r.to[0] - 1.8}
                y={r.to[1] - 1.8}
                width="3.6"
                height="3.6"
                fill="none"
                stroke={color}
                strokeOpacity={0.75}
                strokeWidth="0.35"
              />
              <text
                x={r.to[0]}
                y={r.to[1] + 5.4}
                textAnchor="middle"
                fontSize="2"
                fill={color}
                fillOpacity={0.8}
                className="font-mono"
              >
                {AGENCY_META[p.agency].country.toUpperCase()}
              </text>
            </g>
          );
        })}

        {/* Couriers */}
        {view.messengers.map((m) => {
          const r = routeFor(m);
          // Interpolate forward from the server's progress only while moving.
          // A stalled courier must sit exactly still, or the map would lie
          // about where it is.
          const drift = m.stalled ? 0 : (now - view.now) / Math.max(1, m.transitMs);
          const t = Math.min(1, Math.max(0, m.progress + drift));
          const [x, y] = pointAt(r, t);
          const color = colorOf(m.ownerSlot);
          const mine = m.ownerSlot === view.youSlot;
          const selected = m.id === selectedId;
          const urgent = !m.stalled && m.arrivesAt - now < 8000;
          const size = m.kind === "AMBIENT" ? 1.5 : 2.2;

          return (
            <g
              key={m.id}
              onClick={() => onSelect(m.id)}
              className={mine ? "cursor-default" : "cursor-pointer"}
              role={mine ? undefined : "button"}
              aria-label={mine ? `Your courier ${m.codename}` : `Intercept ${m.codename}`}
            >
              {/* Generous invisible hit area — this has to work with a thumb. */}
              <circle cx={x} cy={y} r="5.5" fill="transparent" />

              {selected && (
                <circle
                  cx={x}
                  cy={y}
                  r={size + 2.4}
                  fill="none"
                  stroke="#fbbf24"
                  strokeWidth="0.4"
                  strokeDasharray="1 1"
                />
              )}
              {m.me.engaged && !m.me.committed && (
                <circle cx={x} cy={y} r={size + 1.4} fill="none" stroke="#fbbf24" strokeOpacity="0.5" strokeWidth="0.3" />
              )}
              {m.stalled && (
                <>
                  <circle cx={x} cy={y} r={size + 2.8} fill="none" stroke="#ff8b95"
                          strokeWidth="0.45" strokeDasharray="0.8 1.2" />
                  <text x={x} y={y + size + 4.2} textAnchor="middle" fontSize="1.8"
                        fill="#ff8b95" className="font-mono">PANNE</text>
                </>
              )}
              {urgent && m.kind !== "AMBIENT" && (
                <circle cx={x} cy={y} r={size} fill={color} fillOpacity="0.25" className="animate-pulseRing" />
              )}

              {m.kind === "AMBIENT" ? (
                <circle cx={x} cy={y} r={size} fill="#94a3b8" fillOpacity="0.95" />
              ) : (
                <>
                  <rect
                    x={x - size}
                    y={y - size * 0.72}
                    width={size * 2}
                    height={size * 1.44}
                    rx="0.4"
                    fill={color}
                    fillOpacity={mine ? 0.95 : 0.85}
                    stroke={m.escorted ? "#fbbf24" : "none"}
                    strokeWidth="0.35"
                  />
                  <path
                    d={`M ${x - size} ${y - size * 0.72} L ${x} ${y + size * 0.1} L ${x + size} ${y - size * 0.72}`}
                    fill="none"
                    stroke="#05070c"
                    strokeOpacity="0.55"
                    strokeWidth="0.3"
                  />
                </>
              )}

              {/* Label height alternates by slot, so two couriers that do pass
                  close together still read separately. */}
              {m.kind !== "AMBIENT" && (
                <text
                  x={x}
                  y={y - size - 1.2 - ((m.ownerSlot ?? 0) % 2) * 2.6}
                  textAnchor="middle"
                  fontSize="1.9"
                  fill={color}
                  fillOpacity="1"
                  className="font-mono"
                >
                  {m.contenders > 0 ? `${m.codename} ·${m.contenders}` : m.codename}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
