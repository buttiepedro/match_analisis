import { useEffect, useRef, useState } from "react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import api from "../lib/axios";
import { positionByJersey } from "../lib/rugby";

function photoSrc(url: string | null | undefined): string | null {
  return url ?? null;
}

interface LineupEntry {
  id: string;
  jersey_number: number;
  position: string | null;
  team: string;
  status: string;
  player: { id: string; name: string; position: string | null; profile_photo_url?: string | null };
}

interface Session {
  id: string;
  home_team: string;
  away_team: string;
  scheduled_at: string | null;
  status: string;
}

interface Tournament {
  id: string;
  name: string;
  season: string | null;
  division: { id: string; name: string };
}

interface Props {
  isOpen: boolean;
  session: Session | null;
  tournament: Tournament | null;
  onClose: () => void;
}

// Fixed rugby formation coordinates (x%, y%) within the SVG field area
// Layout: scrum at top, backs at bottom — same orientation as the image reference
const POSITION_COORDS: Record<number, { x: number; y: number }> = {
  // Front row
  2:  { x: 50, y: 13 },
  1:  { x: 34, y: 16 },
  3:  { x: 66, y: 16 },
  // Locks
  4:  { x: 40, y: 26 },
  5:  { x: 60, y: 26 },
  // Back row — flankers wide, 8 in the middle
  6:  { x: 19, y: 36 },
  8:  { x: 50, y: 38 },
  7:  { x: 81, y: 36 },
  // Halfbacks
  9:  { x: 36, y: 50 },
  10: { x: 64, y: 53 },
  // Backs line — wings at the edges, centers inside, fullback deepest
  11: { x: 9,  y: 65 },
  12: { x: 30, y: 64 },
  13: { x: 70, y: 64 },
  14: { x: 91, y: 65 },
  15: { x: 50, y: 75 },
};

function lastName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1];
}

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, { mode: "cors", cache: "force-cache" });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

export default function FieldViewModal({ isOpen, session, tournament, onClose }: Props) {
  const [lineup, setLineup] = useState<LineupEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // player positions on field — maps jersey_number → display position key (1-15)
  // initially identity, swap changes it
  const [slotMap, setSlotMap] = useState<Record<number, number>>({});
  const [selected, setSelected] = useState<number | null>(null); // jersey_number of selected player

  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || !session) return;
    setLineup([]);
    setSlotMap({});
    setSelected(null);
    setLoading(true);
    api.get<LineupEntry[]>(`/sessions/${session.id}/lineup`)
      .then(({ data }) => {
        setLineup(data);
        // init slotMap: each on_field player occupies their own jersey slot
        const map: Record<number, number> = {};
        data.filter((e) => e.status === "on_field" && e.team === "user").forEach((e) => {
          map[e.jersey_number] = e.jersey_number;
        });
        setSlotMap(map);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isOpen, session]);

  if (!isOpen || !session) return null;

  const userOnField = lineup.filter((e) => e.status === "on_field" && e.team === "user");
  const userBench   = lineup.filter((e) => e.status === "bench"    && e.team === "user")
    .sort((a, b) => a.jersey_number - b.jersey_number);

  // Build slot → player map using slotMap
  const slotToPlayer: Record<number, LineupEntry> = {};
  userOnField.forEach((e) => {
    const slot = slotMap[e.jersey_number] ?? e.jersey_number;
    slotToPlayer[slot] = e;
  });

  function handlePlayerClick(jerseyNumber: number) {
    if (selected === null) {
      setSelected(jerseyNumber);
    } else if (selected === jerseyNumber) {
      setSelected(null);
    } else {
      // Swap the two players in slotMap
      setSlotMap((prev) => {
        const next = { ...prev };
        const slotA = next[selected]    ?? selected;
        const slotB = next[jerseyNumber] ?? jerseyNumber;
        next[selected]     = slotB;
        next[jerseyNumber] = slotA;
        return next;
      });
      setSelected(null);
    }
  }

  async function handleExportPDF() {
    if (!printRef.current || !session) return;
    setExporting(true);

    const svgEl = printRef.current.querySelector("svg");
    const imgEls = svgEl ? Array.from(svgEl.querySelectorAll("image")) : [];
    const origHrefs = imgEls.map((el) => el.getAttribute("href") ?? "");

    try {
      // Pre-load S3 images as data URLs so html2canvas can render them
      // (html2canvas can't fetch cross-origin images without CORS headers)
      await Promise.all(
        imgEls.map(async (el, i) => {
          const href = origHrefs[i];
          if (!href || href.startsWith("data:")) return;
          const dataUrl = await toDataUrl(href);
          if (dataUrl) el.setAttribute("href", dataUrl);
        }),
      );

      const canvas = await html2canvas(printRef.current, {
        backgroundColor: "#111827",
        scale: 2,
        useCORS: true,
        logging: false,
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const ratio = canvas.height / canvas.width;
      const imgW = pageW - 20;
      const imgH = imgW * ratio;
      const yOff = Math.max(10, (pageH - imgH) / 2);
      pdf.addImage(imgData, "PNG", 10, yOff, imgW, Math.min(imgH, pageH - 20));
      const safe = (s: string) => s.replace(/[^a-z0-9áéíóúñ\s]/gi, "").trim().replace(/\s+/g, "_");
      const dateStr = session.scheduled_at ? session.scheduled_at.slice(0, 10) : "sin_fecha";
      pdf.save(`formacion_${safe(session.home_team)}_vs_${safe(session.away_team)}_${dateStr}.pdf`);
    } catch (err) {
      console.error("PDF export error:", err);
      alert("Error al exportar PDF");
    } finally {
      // Always restore original hrefs
      imgEls.forEach((el, i) => el.setAttribute("href", origHrefs[i]));
      setExporting(false);
    }
  }

  const fieldW = 360;
  const fieldH = 540;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-4xl max-h-[95vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-gray-700 flex items-center justify-between flex-shrink-0">
          <h2 className="text-white font-bold text-lg">Vista de Cancha</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none transition-colors">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <p className="text-gray-400 text-sm text-center py-12">Cargando alineación...</p>
          ) : (
            <div ref={printRef} className="space-y-4">

              {/* Match info */}
              <div className="bg-gray-800 rounded-xl px-5 py-4">
                <div className="flex items-center justify-center gap-4 mb-1">
                  <span className="text-white font-bold text-xl">{session.home_team}</span>
                  <span className="text-gray-400 text-lg font-light">vs</span>
                  <span className="text-white font-bold text-xl">{session.away_team}</span>
                </div>
                <div className="text-center text-gray-400 text-sm">
                  {tournament && (
                    <span>{tournament.name} · {tournament.division.name}{tournament.season ? ` · ${tournament.season}` : ""}</span>
                  )}
                  {session.scheduled_at && (
                    <span className="ml-2">· {formatDate(session.scheduled_at)} {formatTime(session.scheduled_at)}</span>
                  )}
                </div>
              </div>

              {userOnField.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-8">
                  No hay jugadores titulares cargados para este partido.
                </p>
              ) : (
                <div className="flex gap-4 items-start">

                  {/* SVG field */}
                  <div className="flex-shrink-0">
                    <p className="text-xs text-gray-500 mb-2 text-center">
                      {selected !== null ? "Seleccioná otro jugador para intercambiar posiciones" : "Click en dos jugadores para intercambiar posiciones"}
                    </p>
                    <svg
                      width={fieldW}
                      height={fieldH}
                      viewBox={`0 0 ${fieldW} ${fieldH}`}
                      style={{ display: "block" }}
                    >
                      {/* Field background */}
                      <rect width={fieldW} height={fieldH} rx="8" fill="#14532d" />

                      {/* Field lines */}
                      {/* Try lines */}
                      <rect x="10" y="10"  width={fieldW - 20} height="2"   fill="#166534" opacity="0.8" />
                      <rect x="10" y={fieldH - 12} width={fieldW - 20} height="2" fill="#166534" opacity="0.8" />
                      {/* 22m lines */}
                      <rect x="10" y="105" width={fieldW - 20} height="1.5" fill="#166534" opacity="0.6" />
                      <rect x="10" y={fieldH - 110} width={fieldW - 20} height="1.5" fill="#166534" opacity="0.6" />
                      {/* Halfway */}
                      <rect x="10" y={fieldH / 2} width={fieldW - 20} height="2" fill="#166534" opacity="0.8" />
                      {/* Center circle */}
                      <circle cx={fieldW / 2} cy={fieldH / 2} r="18" fill="none" stroke="#166534" strokeWidth="1.5" opacity="0.7" />
                      {/* Sidelines */}
                      <rect x="10"        y="10" width="2"   height={fieldH - 20} fill="#166534" opacity="0.8" />
                      <rect x={fieldW-12} y="10" width="2"   height={fieldH - 20} fill="#166534" opacity="0.8" />
                      {/* Posts top */}
                      <line x1={fieldW/2 - 12} y1="10" x2={fieldW/2 - 12} y2="32" stroke="#22c55e" strokeWidth="1.5" opacity="0.6" />
                      <line x1={fieldW/2 + 12} y1="10" x2={fieldW/2 + 12} y2="32" stroke="#22c55e" strokeWidth="1.5" opacity="0.6" />
                      <line x1={fieldW/2 - 12} y1="32" x2={fieldW/2 + 12} y2="32" stroke="#22c55e" strokeWidth="1.5" opacity="0.6" />
                      {/* Posts bottom */}
                      <line x1={fieldW/2 - 12} y1={fieldH-10} x2={fieldW/2 - 12} y2={fieldH-32} stroke="#22c55e" strokeWidth="1.5" opacity="0.6" />
                      <line x1={fieldW/2 + 12} y1={fieldH-10} x2={fieldW/2 + 12} y2={fieldH-32} stroke="#22c55e" strokeWidth="1.5" opacity="0.6" />
                      <line x1={fieldW/2 - 12} y1={fieldH-32} x2={fieldW/2 + 12} y2={fieldH-32} stroke="#22c55e" strokeWidth="1.5" opacity="0.6" />

                      {/* Players */}
                      {Object.entries(POSITION_COORDS).map(([slotStr, coords]) => {
                        const slot = Number(slotStr);
                        const player = slotToPlayer[slot];
                        if (!player) return null;

                        const cx = (coords.x / 100) * fieldW;
                        const cy = (coords.y / 100) * fieldH;
                        const isSelected = selected === player.jersey_number;
                        const imgSrc = photoSrc(player.player.profile_photo_url);
                        const r = 20;

                        return (
                          <g
                            key={slot}
                            onClick={() => handlePlayerClick(player.jersey_number)}
                            style={{ cursor: "pointer" }}
                          >
                            {/* Selection ring */}
                            {isSelected && (
                              <circle cx={cx} cy={cy} r={r + 5} fill="none" stroke="#fbbf24" strokeWidth="2.5" opacity="0.9" />
                            )}
                            {/* Player circle background — only shown when no photo */}
                            {!imgSrc && (
                              <circle
                                cx={cx} cy={cy} r={r}
                                fill={isSelected ? "#064e3b" : "#065f46"}
                                stroke={isSelected ? "#fbbf24" : "#34d399"}
                                strokeWidth={isSelected ? "2.5" : "1.5"}
                              />
                            )}
                            {imgSrc ? (
                              /* Photo — no clip, PNG transparency shows through */
                              <image
                                href={imgSrc}
                                x={cx - r} y={cy - r}
                                width={r * 2} height={r * 2}
                                preserveAspectRatio="xMidYMid meet"
                              />
                            ) : (
                              /* Jersey number fallback */
                              <text
                                x={cx} y={cy + 1}
                                textAnchor="middle" dominantBaseline="middle"
                                fill="white" fontSize="13" fontWeight="bold"
                                style={{ fontFamily: "system-ui, sans-serif", userSelect: "none" }}
                              >
                                {player.jersey_number}
                              </text>
                            )}
                            {/* Jersey number badge over photo */}
                            {imgSrc && (
                              <>
                                <circle cx={cx + r - 6} cy={cy - r + 6} r="7" fill="#065f46" stroke="#34d399" strokeWidth="1" />
                                <text
                                  x={cx + r - 6} y={cy - r + 7}
                                  textAnchor="middle" dominantBaseline="middle"
                                  fill="white" fontSize="7" fontWeight="bold"
                                  style={{ fontFamily: "system-ui, sans-serif", userSelect: "none" }}
                                >
                                  {player.jersey_number}
                                </text>
                              </>
                            )}
                            {/* Player last name below circle */}
                            <text
                              x={cx} y={cy + r + 8}
                              textAnchor="middle" dominantBaseline="middle"
                              fill="#d1fae5" fontSize="8"
                              style={{ fontFamily: "system-ui, sans-serif", userSelect: "none" }}
                            >
                              {lastName(player.player.name)}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>

                  {/* Bench */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-2">Suplentes</p>
                    <div className="space-y-1">
                      {Array.from({ length: 8 }, (_, i) => i + 16).map((n) => {
                        const entry = userBench.find((e) => e.jersey_number === n);
                        const src = entry ? photoSrc(entry.player.profile_photo_url) : null;
                        return (
                          <div key={n} className="flex items-center gap-3 bg-gray-800 rounded-lg px-3 py-2">
                            {entry ? (
                              <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-700 flex items-center justify-center flex-shrink-0">
                                {src ? (
                                  <img src={src} alt={entry.player.name} className="w-full h-full object-cover" />
                                ) : (
                                  <span className="text-green-400 font-bold text-sm">{n}</span>
                                )}
                              </div>
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0">
                                <span className="text-gray-600 font-bold text-sm">{n}</span>
                              </div>
                            )}
                            {entry ? (
                              <>
                                <span className="text-white text-sm truncate flex-1">{entry.player.name}</span>
                                <span className="text-gray-400 text-xs flex-shrink-0">
                                  {entry.position ?? positionByJersey(n) ?? "—"}
                                </span>
                              </>
                            ) : (
                              <span className="text-gray-600 text-sm italic flex-1">—</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 pt-3 border-t border-gray-700 flex items-center justify-between flex-shrink-0">
          <button
            onClick={onClose}
            className="text-sm text-gray-400 hover:text-white px-4 py-2 rounded-lg transition-colors"
          >
            Cerrar
          </button>
          <button
            onClick={handleExportPDF}
            disabled={exporting || loading || userOnField.length === 0}
            className="text-sm bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white px-5 py-2 rounded-lg transition-colors font-medium"
          >
            {exporting ? "Exportando..." : "Exportar PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}
