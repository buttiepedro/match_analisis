import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Screen from "../../src/components/Screen";
import DivisionAccordion from "../../src/components/DivisionAccordion";
import { EmptyState, ErrorBanner, Loading, Pill, SegmentedControl } from "../../src/components/Kit";
import api from "../../src/lib/api";
import { parseApiError } from "../../src/lib/errors";
import { useOwnDivisionId, withOwnFirst } from "../../src/lib/useOwnDivision";
import { useAuthStore } from "../../src/store/authStore";
import { colors, spacing } from "../../src/theme";

// ── Fixture ──────────────────────────────────────────────────────────────────

interface FixtureMatch {
  session_id: string;
  home_team: string;
  away_team: string;
  scheduled_at: string | null;
  status: string;
  home_score: number | null;
  away_score: number | null;
}
interface DivisionFixture {
  division_id: string;
  division_name: string;
  matches: FixtureMatch[];
}

function formatMatchDate(iso: string | null): string {
  if (!iso) return "Sin fecha";
  return new Date(iso).toLocaleDateString("es-AR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function FixtureView({ clubId, ownDivisionId }: { clubId: string; ownDivisionId: string | null }) {
  const [divisions, setDivisions] = useState<DivisionFixture[]>([]);
  const [upcomingOnly, setUpcomingOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    api
      .get<DivisionFixture[]>(`/clubs/${clubId}/fixture`, { params: { upcoming: upcomingOnly } })
      .then(({ data }) => setDivisions(data))
      .catch((err) => setError(parseApiError(err, "No se pudo cargar el fixture")))
      .finally(() => setLoading(false));
  }, [clubId, upcomingOnly]);

  const ordered = withOwnFirst(divisions, ownDivisionId);

  return (
    <View style={{ gap: spacing.md }}>
      <SegmentedControl
        value={upcomingOnly ? "proximos" : "todos"}
        onChange={(v) => setUpcomingOnly(v === "proximos")}
        options={[
          { key: "proximos", label: "Próximos" },
          { key: "todos", label: "Todos" },
        ]}
      />
      <ErrorBanner>{error}</ErrorBanner>
      {loading ? (
        <Loading />
      ) : ordered.length === 0 ? (
        <EmptyState>El club todavía no tiene divisiones cargadas.</EmptyState>
      ) : (
        ordered.map((d, i) => (
          <DivisionAccordion key={d.division_id} title={d.division_name} defaultOpen={i === 0}>
            {d.matches.length === 0 ? (
              <Text style={styles.sectionEmpty}>
                {upcomingOnly ? "Sin partidos próximos." : "Sin partidos cargados."}
              </Text>
            ) : (
              d.matches.map((m, idx) => (
                <View key={m.session_id} style={[styles.row, idx > 0 && styles.rowBorder]}>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {m.home_team} vs {m.away_team}
                    </Text>
                    <Text style={styles.rowMeta}>{formatMatchDate(m.scheduled_at)}</Text>
                  </View>
                  {m.status === "finished" ? (
                    <Text style={styles.score}>
                      {m.home_score} - {m.away_score}
                    </Text>
                  ) : m.status !== "scheduled" ? (
                    <Text style={styles.live}>en juego</Text>
                  ) : null}
                </View>
              ))
            )}
          </DivisionAccordion>
        ))
      )}
    </View>
  );
}

// ── Tablas ───────────────────────────────────────────────────────────────────

interface StandingRow {
  team: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  difference: number;
  bonus: number;
  points: number;
}
interface DivisionStandings {
  division_id: string;
  division_name: string;
  tournament_id: string | null;
  rows: StandingRow[];
}

const COLUMNS: { key: keyof StandingRow; label: string }[] = [
  { key: "played", label: "PJ" },
  { key: "won", label: "G" },
  { key: "drawn", label: "E" },
  { key: "lost", label: "P" },
  { key: "difference", label: "Dif" },
  { key: "points", label: "Pts" },
];

function StandingsView({ clubId, ownDivisionId }: { clubId: string; ownDivisionId: string | null }) {
  const [divisions, setDivisions] = useState<DivisionStandings[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get<DivisionStandings[]>(`/clubs/${clubId}/standings`)
      .then(({ data }) => setDivisions(data))
      .catch((err) => setError(parseApiError(err, "No se pudo cargar la tabla")))
      .finally(() => setLoading(false));
  }, [clubId]);

  const ordered = withOwnFirst(divisions, ownDivisionId);

  if (loading) return <Loading />;

  return (
    <View style={{ gap: spacing.md }}>
      <ErrorBanner>{error}</ErrorBanner>
      {ordered.length === 0 ? (
        <EmptyState>El club todavía no tiene divisiones cargadas.</EmptyState>
      ) : (
        ordered.map((d, i) => (
          <DivisionAccordion key={d.division_id} title={d.division_name} defaultOpen={i === 0}>
            {!d.tournament_id ? (
              <Text style={styles.sectionEmpty}>Esta división no tiene torneo activo cargado.</Text>
            ) : d.rows.length === 0 ? (
              <Text style={styles.sectionEmpty}>Todavía no hay partidos terminados en este torneo.</Text>
            ) : (
              <ScrollView horizontal contentContainerStyle={styles.tableScroll}>
                <View>
                  <View style={styles.tableHeaderRow}>
                    <Text style={[styles.tableCell, styles.teamCell, styles.tableHeaderText]}>Equipo</Text>
                    {COLUMNS.map((c) => (
                      <Text key={c.key} style={[styles.tableCell, styles.tableHeaderText]}>
                        {c.label}
                      </Text>
                    ))}
                  </View>
                  {d.rows.map((r, idx) => (
                    <View key={r.team} style={[styles.tableRow, idx > 0 && styles.rowBorder]}>
                      <Text style={[styles.tableCell, styles.teamCell]} numberOfLines={1}>
                        {idx + 1}. {r.team}
                      </Text>
                      {COLUMNS.map((c) => (
                        <Text
                          key={c.key}
                          style={[styles.tableCell, c.key === "points" && styles.tableCellStrong]}
                        >
                          {r[c.key]}
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              </ScrollView>
            )}
          </DivisionAccordion>
        ))
      )}
    </View>
  );
}

// ── Citados ──────────────────────────────────────────────────────────────────

interface SquadMember {
  player_id: string;
  player_name: string;
  position: string | null;
  status: string;
}
interface DivisionConvocatoria {
  division_id: string;
  division_name: string;
  home_team: string | null;
  away_team: string | null;
  scheduled_at: string | null;
  members: SquadMember[];
  reason: "sin_convocatoria" | null;
}

const STATUS_LABEL: Record<string, string> = { convocado: "Convocado", confirmado: "Confirmado", baja: "Baja" };
const STATUS_TONE: Record<string, "sky" | "brand" | "danger"> = {
  convocado: "sky",
  confirmado: "brand",
  baja: "danger",
};

function ConvocatoriasView({ clubId, ownDivisionId }: { clubId: string; ownDivisionId: string | null }) {
  const [divisions, setDivisions] = useState<DivisionConvocatoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get<DivisionConvocatoria[]>(`/clubs/${clubId}/convocatorias`)
      .then(({ data }) => setDivisions(data))
      .catch((err) => setError(parseApiError(err, "No se pudieron cargar los citados")))
      .finally(() => setLoading(false));
  }, [clubId]);

  const ordered = withOwnFirst(divisions, ownDivisionId);

  if (loading) return <Loading />;

  return (
    <View style={{ gap: spacing.md }}>
      <ErrorBanner>{error}</ErrorBanner>
      {ordered.length === 0 ? (
        <EmptyState>El club todavía no tiene divisiones cargadas.</EmptyState>
      ) : (
        ordered.map((d, i) => (
          <DivisionAccordion
            key={d.division_id}
            title={d.division_name}
            defaultOpen={i === 0}
            badge={
              <Text style={styles.badgeText}>
                {d.reason ? "Sin convocatoria" : `${d.members.length} citados`}
              </Text>
            }
          >
            {d.reason ? (
              <Text style={styles.sectionEmpty}>Todavía no hay convocatoria cargada para el próximo partido.</Text>
            ) : (
              <>
                <Text style={styles.matchMeta}>
                  {d.home_team} vs {d.away_team} · {formatMatchDate(d.scheduled_at)}
                </Text>
                {d.members.map((m, idx) => (
                  <View key={m.player_id} style={[styles.row, idx > 0 && styles.rowBorder]}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {m.player_name}
                    </Text>
                    <Pill label={STATUS_LABEL[m.status] ?? m.status} tone={STATUS_TONE[m.status] ?? "neutral"} />
                  </View>
                ))}
              </>
            )}
          </DivisionAccordion>
        ))
      )}
    </View>
  );
}

// ── Pantalla ─────────────────────────────────────────────────────────────────

type ClubView = "fixture" | "tablas" | "citados";

/**
 * Fixture, tablas y citados de **todas** las divisiones del club — mismo
 * endpoint que usa la web ([[add-portal-multidivision]]), mismo criterio de
 * ordenar con la división propia primero. Tres pantallas web, un tab acá
 * con selector, para no sumar más tabs de los que
 * [[navigation]] ya demostró que caben.
 */
export default function Club() {
  const user = useAuthStore((s) => s.user);
  const ownDivisionId = useOwnDivisionId();
  const [view, setView] = useState<ClubView>("fixture");

  if (!user?.club_id) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen>
      <SegmentedControl
        value={view}
        onChange={setView}
        options={[
          { key: "fixture", label: "Fixture" },
          { key: "tablas", label: "Tablas" },
          { key: "citados", label: "Citados" },
        ]}
      />
      <View style={{ height: spacing.lg }} />
      {view === "fixture" && <FixtureView clubId={user.club_id} ownDivisionId={ownDivisionId} />}
      {view === "tablas" && <StandingsView clubId={user.club_id} ownDivisionId={ownDivisionId} />}
      {view === "citados" && <ConvocatoriasView clubId={user.club_id} ownDivisionId={ownDivisionId} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionEmpty: { color: colors.inkMuted, fontSize: 13, padding: spacing.lg },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  rowBody: { flex: 1 },
  rowTitle: { flex: 1, fontSize: 14, color: colors.ink },
  rowMeta: { fontSize: 12, color: colors.inkMuted, marginTop: 2 },
  score: { fontSize: 14, fontWeight: "700", color: colors.ink },
  live: { fontSize: 11, color: colors.brand },
  badgeText: { fontSize: 11, color: colors.inkFaint },
  matchMeta: { fontSize: 12, color: colors.inkMuted, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  tableScroll: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  tableHeaderRow: { flexDirection: "row", paddingBottom: spacing.xs },
  tableRow: { flexDirection: "row", paddingVertical: spacing.xs },
  tableCell: { width: 44, fontSize: 12, color: colors.inkSoft, textAlign: "right" },
  teamCell: { width: 140, textAlign: "left", color: colors.ink },
  tableHeaderText: { fontSize: 10, color: colors.inkFaint, textTransform: "uppercase" },
  tableCellStrong: { fontWeight: "700", color: colors.ink },
});
