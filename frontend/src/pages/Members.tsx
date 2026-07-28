import { useEffect, useMemo, useRef, useState } from "react";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";
import { useAuthStore } from "../store/authStore";

interface Member {
  id: string;
  full_name: string;
  document_id: string | null;
  category: string | null;
  member_number: string | null;
  dues_up_to_date: boolean;
  dues_synced_at: string;
}

interface LinkableUser {
  id: string;
  full_name: string;
  email: string | null;
  document_id: string | null;
}

interface ImportResult {
  dry_run: boolean;
  created: string[];
  updated: string[];
  deactivated: string[];
  total_rows: number;
  errors: { row: number; reason: string }[];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

export default function Members() {
  const user = useAuthStore((s) => s.user);
  const clubId = user?.club_id;

  const [members, setMembers] = useState<Member[]>([]);
  const [search, setSearch] = useState("");
  const [onlyDebtors, setOnlyDebtors] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [defaultPassword, setDefaultPassword] = useState("");
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ImportResult | null>(null);
  /** Se habilita sólo cuando el backend frenó por bajas masivas. */
  const [needsForce, setNeedsForce] = useState(false);

  // ── Alta suelta ─────────────────────────────────────────────────────────
  const [adding, setAdding] = useState(false);
  const [linkable, setLinkable] = useState<LinkableUser[]>([]);
  const [form, setForm] = useState({
    user_id: "",
    document_id: "",
    full_name: "",
    member_number: "",
    default_password: "",
    dues_up_to_date: false,
  });

  const openAdd = () => {
    setAdding(true);
    setError("");
    api
      .get<LinkableUser[]>(`/clubs/${clubId}/linkable-users`)
      .then(({ data }) => setLinkable(data))
      .catch(() => setLinkable([]));
  };

  const createMember = async () => {
    setBusy(true);
    setError("");
    try {
      await api.post(`/clubs/${clubId}/members`, {
        ...form,
        user_id: form.user_id || null,
        full_name: form.full_name || null,
        member_number: form.member_number || null,
        default_password: form.default_password || null,
      });
      setAdding(false);
      setForm({
        user_id: "", document_id: "", full_name: "",
        member_number: "", default_password: "", dues_up_to_date: false,
      });
      load();
    } catch (err) {
      setError(parseApiError(err, "No se pudo dar de alta al socio"));
    } finally {
      setBusy(false);
    }
  };

  const elegido = linkable.find((u) => u.id === form.user_id);

  const load = () => {
    if (!clubId) return;
    api
      .get<Member[]>(`/clubs/${clubId}/members`, {
        params: { only_debtors: onlyDebtors || undefined },
      })
      .then(({ data }) => setMembers(data))
      .catch((err) => setError(parseApiError(err, "No se pudo cargar el padrón")))
      .finally(() => setLoading(false));
  };

  useEffect(load, [clubId, onlyDebtors]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.full_name.toLowerCase().includes(q) ||
        (m.document_id ?? "").includes(q) ||
        (m.member_number ?? "").includes(q)
    );
  }, [members, search]);

  const debtors = useMemo(() => members.filter((m) => !m.dues_up_to_date).length, [members]);

  const runImport = async (opts: { dryRun: boolean; force?: boolean }) => {
    if (!clubId || !file) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("default_password", defaultPassword);

      const { data } = await api.post<ImportResult>(
        `/clubs/${clubId}/members/import`,
        form,
        {
          params: { dry_run: opts.dryRun, force: opts.force || undefined },
          headers: { "Content-Type": "multipart/form-data" },
        }
      );

      if (opts.dryRun) {
        setPreview(data);
        setNeedsForce(false);
      } else {
        setDone(data);
        setPreview(null);
        setFile(null);
        setNeedsForce(false);
        if (fileRef.current) fileRef.current.value = "";
        load();
      }
    } catch (err: any) {
      // 409 = freno por bajas masivas. Es recuperable con force, pero sólo
      // después de que alguien mire la lista.
      setNeedsForce(err?.response?.status === 409);
      setError(parseApiError(err, "No se pudo importar el padrón"));
    } finally {
      setBusy(false);
    }
  };

  if (!clubId) return null;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto pb-10">
      <h1 className="text-lg font-bold text-ink mb-1">Socios</h1>
      <p className="text-xs text-ink-muted mb-5">
        El estado de cuota lo informa el sistema contable del club. La app lo
        espeja: no calcula deuda ni procesa pagos.
      </p>

      {/* Alta suelta */}
      <section className="bg-surface rounded-xl p-4 mb-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-ink">Dar de alta un socio</p>
          {!adding && (
            <button
              onClick={openAdd}
              className="pressable text-xs font-semibold text-brand hover:text-brand-hover"
            >
              + Nuevo
            </button>
          )}
        </div>

        {adding && (
          <div className="mt-3 space-y-2">
            <div>
              <label className="text-[11px] text-ink-muted block mb-1">
                Usuario del club (opcional)
              </label>
              <select
                value={form.user_id}
                onChange={(e) => {
                  const u = linkable.find((x) => x.id === e.target.value);
                  setForm((f) => ({
                    ...f,
                    user_id: e.target.value,
                    // Se precargan para no obligar a reescribir lo que ya sabemos.
                    full_name: u?.full_name ?? f.full_name,
                    document_id: u?.document_id ?? f.document_id,
                  }));
                }}
                className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-brand-ring"
              >
                <option value="">— Crear una cuenta nueva —</option>
                {linkable.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name}{u.email ? ` · ${u.email}` : ""}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-ink-faint mt-1">
                Si la persona ya entra a la app —por ejemplo vos—, elegila acá en vez
                de crearle una segunda cuenta.
              </p>
            </div>

            <input
              placeholder="DNI"
              value={form.document_id}
              onChange={(e) => setForm((f) => ({ ...f, document_id: e.target.value }))}
              className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 placeholder-ink-faint outline-none focus:ring-1 focus:ring-brand-ring"
            />
            <p className="text-[11px] text-ink-faint">
              Obligatorio: la sincronización semanal del padrón busca por DNI. Sin él,
              la próxima importación daría a este socio de baja por ausente y crearía
              otro al lado.
            </p>

            <input
              placeholder="Nombre y apellido"
              value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 placeholder-ink-faint outline-none focus:ring-1 focus:ring-brand-ring"
            />
            <input
              placeholder="N° de socio (opcional)"
              value={form.member_number}
              onChange={(e) => setForm((f) => ({ ...f, member_number: e.target.value }))}
              className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 placeholder-ink-faint outline-none focus:ring-1 focus:ring-brand-ring"
            />

            {!form.user_id && (
              <input
                type="password"
                placeholder="Contraseña inicial de su cuenta"
                value={form.default_password}
                onChange={(e) => setForm((f) => ({ ...f, default_password: e.target.value }))}
                className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 placeholder-ink-faint outline-none focus:ring-1 focus:ring-brand-ring"
              />
            )}

            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <input
                type="checkbox"
                checked={form.dues_up_to_date}
                onChange={(e) => setForm((f) => ({ ...f, dues_up_to_date: e.target.checked }))}
                className="accent-brand"
              />
              Está al día con la cuota
            </label>

            <div className="flex gap-2 pt-1">
              <button
                onClick={createMember}
                disabled={busy || !form.document_id.trim() || (!form.user_id && !form.full_name.trim())}
                className="pressable text-sm bg-brand hover:bg-brand-hover disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium transition-colors duration-150"
              >
                {busy ? "Guardando..." : elegido ? `Hacer socio a ${elegido.full_name}` : "Dar de alta"}
              </button>
              <button
                onClick={() => setAdding(false)}
                className="pressable text-sm text-ink-muted hover:text-ink px-4 py-2 rounded-lg"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Import */}
      <section className="bg-surface rounded-xl p-4 mb-5">
        <p className="text-sm font-semibold text-ink mb-3">Actualizar padrón</p>

        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setDone(null); }}
          className="block w-full text-xs text-ink-muted mb-2 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-surface-strong file:text-ink"
        />

        <input
          type="password"
          placeholder="Contraseña inicial para los socios nuevos"
          value={defaultPassword}
          onChange={(e) => setDefaultPassword(e.target.value)}
          className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 mb-1 placeholder-ink-faint outline-none focus:ring-1 focus:ring-brand-ring"
        />
        <p className="text-[11px] text-ink-faint mb-3">
          Mínimo 8 caracteres. Cada socio la cambia en su primer ingreso. No uses
          el DNI: sería usuario y contraseña el mismo dato.
        </p>

        <div className="flex gap-2">
          <button
            onClick={() => runImport({ dryRun: true })}
            disabled={!file || busy}
            className="pressable flex-1 bg-surface-strong hover:bg-surface-hover disabled:opacity-40 text-ink text-sm font-semibold py-2 rounded-lg transition-colors duration-150"
          >
            {busy ? "..." : "Ver qué cambiaría"}
          </button>
          {preview && (
            <button
              onClick={() => runImport({ dryRun: false, force: needsForce })}
              disabled={busy || defaultPassword.length < 8}
              className="pressable flex-1 bg-brand hover:bg-brand-hover disabled:opacity-40 text-white text-sm font-semibold py-2 rounded-lg transition-colors duration-150"
            >
              Confirmar
            </button>
          )}
        </div>

        {error && (
          <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mt-3">
            {error}
            {needsForce && (
              <button
                onClick={() => runImport({ dryRun: false, force: true })}
                className="pressable block mt-2 text-red-700 underline font-semibold"
              >
                Ya lo revisé, importar igual
              </button>
            )}
          </p>
        )}

        {preview && (
          <div className="mt-3 text-xs space-y-1 bg-surface-strong rounded-lg p-3">
            <p className="font-semibold text-ink">
              Vista previa · {preview.total_rows} fila(s) en el archivo
            </p>
            <p className="text-ink-soft">Se dan de alta: {preview.created.length}</p>
            <p className="text-ink-soft">Se actualizan: {preview.updated.length}</p>
            {preview.deactivated.length > 0 && (
              <p className="text-red-700">
                Se dan de baja: {preview.deactivated.length} —{" "}
                {preview.deactivated.slice(0, 8).join(", ")}
                {preview.deactivated.length > 8 && "…"}
              </p>
            )}
            {preview.errors.length > 0 && (
              <p className="text-amber-700">
                {preview.errors.length} fila(s) con problemas:{" "}
                {preview.errors.slice(0, 3).map((e) => `fila ${e.row} (${e.reason})`).join(", ")}
              </p>
            )}
          </div>
        )}

        {done && (
          <p className="text-xs text-brand bg-brand-soft rounded-lg px-3 py-2 mt-3">
            Padrón actualizado: {done.created.length} alta(s), {done.updated.length}{" "}
            actualizado(s), {done.deactivated.length} baja(s).
          </p>
        )}
      </section>

      {/* Padrón */}
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          inputMode="search"
          placeholder="Buscar por nombre, DNI o N° de socio..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-surface text-ink text-sm rounded-xl px-3 py-2.5 placeholder-ink-faint outline-none focus:ring-2 focus:ring-brand-ring"
        />
        <button
          onClick={() => setOnlyDebtors((v) => !v)}
          className={`pressable px-3 rounded-xl text-xs font-semibold transition-colors duration-150 ${
            onlyDebtors ? "bg-red-600 text-white" : "bg-surface text-ink-muted"
          }`}
        >
          Con deuda
        </button>
      </div>

      {loading ? (
        <p className="text-ink-muted text-sm py-8 text-center">Cargando padrón...</p>
      ) : members.length === 0 ? (
        <div className="bg-surface/70 rounded-xl px-4 py-8 text-center">
          <p className="text-ink-muted text-sm">Todavía no se importó el padrón.</p>
          <p className="text-ink-faint text-xs mt-1">
            Subí el Excel que exporta el sistema del club.
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-ink-muted mb-2">
            {members.length} socio(s) activos · {debtors} con cuota pendiente
          </p>
          <ul className="bg-surface/70 rounded-xl divide-y divide-line overflow-hidden">
            {visible.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-ink truncate">{m.full_name}</span>
                  <span className="block text-[11px] text-ink-faint">
                    {m.member_number ? `Socio ${m.member_number} · ` : ""}
                    DNI {m.document_id ?? "—"}
                  </span>
                </span>
                <span
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                    m.dues_up_to_date
                      ? "bg-brand-soft text-brand"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  {m.dues_up_to_date ? "Al día" : "Debe"}
                </span>
                <span className="text-[11px] text-ink-faint shrink-0 tabular-nums w-10 text-right">
                  {formatDate(m.dues_synced_at)}
                </span>
              </li>
            ))}
          </ul>
          {visible.length === 0 && (
            <p className="text-ink-muted text-sm py-6 text-center">Sin resultados.</p>
          )}
        </>
      )}
    </div>
  );
}
