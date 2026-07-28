import { useEffect, useMemo, useState } from "react";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";

interface Role {
  id: string;
  name: string;
  is_preset: boolean;
  /** Propias + heredadas: lo que el rol concede de verdad. */
  permissions: string[];
  /** Lo único editable. */
  own_permissions: string[];
  inherited_permissions: string[];
  parent_role_id: string | null;
  parent_name: string | null;
  user_count: number;
  child_count: number;
}

interface PermissionEntry {
  value: string;
  domain: string;
  action: string;
}

/** Etiquetas legibles. Sin esto la pantalla muestra `entrenamiento.gestionar`. */
const DOMAIN_LABEL: Record<string, string> = {
  plantel: "Plantel",
  asistencia: "Asistencia",
  entrenamiento: "Entrenamientos",
  partido: "Partidos",
  medico: "Médico",
  mediciones: "Mediciones",
  gimnasio: "Gimnasio",
  socios: "Socios y cuotas",
  bolsa: "Bolsa de trabajo",
  club: "Configuración del club",
};

const ACTION_LABEL: Record<string, string> = {
  ver: "Ver",
  editar: "Editar",
  mover: "Mover entre divisiones",
  importar: "Importar",
  cargar: "Cargar",
  gestionar: "Crear y editar",
  timer: "Controlar el timer",
  eventos: "Registrar eventos",
  lineup: "Definir el equipo",
  divisiones: "Divisiones",
  torneos: "Torneos",
  usuarios: "Usuarios y roles",
  rivales: "Rivales",
  publicar: "Publicar avisos",
  moderar: "Moderar avisos",
  // Estas tres son sobre **lo propio**, no sobre el club. Etiquetarlas "Ver" a
  // secas haría que alguien le diera a un jugador acceso a todo el plantel
  // creyendo que le da acceso a su ficha.
  ver_propio: "Ver sólo lo suyo",
  ver_propia: "Ver sólo la suya",
  ver_todas: "Ver las de todos",
};

function label(entry: PermissionEntry): string {
  return ACTION_LABEL[entry.action] ?? entry.action;
}

/**
 * Roles que no se pueden ofrecer como padre de `roleId`: él mismo y su
 * descendencia. El backend igual rechaza el ciclo, pero ofrecer una opción que
 * después da error es hacerle perder el tiempo a quien la elige.
 */
function forbiddenParents(roleId: string, roles: Role[]): Set<string> {
  const blocked = new Set([roleId]);
  let grew = true;
  while (grew) {
    grew = false;
    roles.forEach((r) => {
      if (r.parent_role_id && blocked.has(r.parent_role_id) && !blocked.has(r.id)) {
        blocked.add(r.id);
        grew = true;
      }
    });
  }
  return blocked;
}

export default function RolesTab({ clubId }: { clubId: string }) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [catalog, setCatalog] = useState<PermissionEntry[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const load = () =>
    Promise.all([
      api.get<Role[]>(`/clubs/${clubId}/roles`),
      api.get<PermissionEntry[]>("/permissions"),
    ])
      .then(([r, c]) => {
        setRoles(r.data);
        setCatalog(c.data);
      })
      .catch((err) => setError(parseApiError(err, "No se pudieron cargar los roles")))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, [clubId]);

  const byDomain = useMemo(() => {
    const map: Record<string, PermissionEntry[]> = {};
    catalog.forEach((p) => {
      (map[p.domain] ??= []).push(p);
    });
    return map;
  }, [catalog]);

  const toggle = async (role: Role, permission: string) => {
    // Se togglea contra las **propias**: mandar una heredada la convertiría en
    // propia sin que nadie lo haya pedido.
    const next = role.own_permissions.includes(permission)
      ? role.own_permissions.filter((p) => p !== permission)
      : [...role.own_permissions, permission];

    setError("");
    try {
      await api.patch(`/clubs/${clubId}/roles/${role.id}`, { permissions: next });
      // Se recarga todo y no sólo este rol: si tiene hijos, les cambió lo
      // heredado y sus listas quedaron viejas en pantalla.
      await load();
    } catch (err) {
      setError(parseApiError(err, "No se pudo guardar el cambio"));
    }
  };

  const setParent = async (role: Role, parentId: string) => {
    setError("");
    try {
      await api.patch(
        `/clubs/${clubId}/roles/${role.id}`,
        parentId ? { parent_role_id: parentId } : { clear_parent: true }
      );
      await load();
    } catch (err) {
      // El backend explica el ciclo o el largo de la cadena.
      setError(parseApiError(err, "No se pudo cambiar de quién hereda"));
    }
  };

  const createRole = async () => {
    const name = newName.trim();
    if (!name) return;
    setError("");
    try {
      const { data } = await api.post<Role>(`/clubs/${clubId}/roles`, {
        name,
        permissions: [],
      });
      await load();
      setNewName("");
      setCreating(false);
      setEditing(data.id);
    } catch (err) {
      setError(parseApiError(err, "No se pudo crear el rol"));
    }
  };

  const removeRole = async (role: Role) => {
    if (!confirm(`¿Eliminar el rol "${role.name}"?`)) return;
    setError("");
    try {
      await api.delete(`/clubs/${clubId}/roles/${role.id}`);
      await load();
    } catch (err) {
      // El backend explica por qué no se puede: preset, asignado, o con hijos.
      setError(parseApiError(err, "No se pudo eliminar el rol"));
    }
  };

  if (loading) {
    return <p className="text-ink-muted text-sm py-8 text-center">Cargando roles...</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-muted">
        Un rol puede <strong className="font-semibold text-ink-soft">heredar</strong> de
        otro y sumarle lo suyo — "Jugador hereda de Socio y agrega ver sus tests". Lo
        que cambies en el padre les llega solo a los hijos. Un usuario también puede
        tener varios roles, y ahí las capacidades se suman igual.
      </p>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}

      {roles.map((role) => {
        const open = editing === role.id;
        const blocked = forbiddenParents(role.id, roles);
        return (
          <div key={role.id} className="bg-surface rounded-xl overflow-hidden">
            <button
              onClick={() => setEditing(open ? null : role.id)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-hover transition-colors duration-150"
            >
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-ink truncate">
                  {role.name}
                  {role.is_preset && (
                    <span className="ml-2 text-[10px] font-normal text-ink-faint">
                      del sistema
                    </span>
                  )}
                </span>
                <span className="block text-xs text-ink-muted">
                  {role.parent_name && (
                    <span className="text-brand font-medium">
                      hereda de {role.parent_name} ·{" "}
                    </span>
                  )}
                  {role.permissions.length === 0
                    ? "Sin permisos"
                    : `${role.permissions.length} permiso(s)`}
                  {role.user_count > 0 && ` · ${role.user_count} usuario(s)`}
                </span>
              </span>
              <span className="text-ink-faint text-xs shrink-0">{open ? "▲" : "▼"}</span>
            </button>

            {open && (
              <div className="px-4 pb-4 border-t border-line pt-3 space-y-3">
                <div>
                  <label className="block text-[11px] font-bold text-ink-muted uppercase tracking-wider mb-1.5">
                    Hereda de
                  </label>
                  <select
                    value={role.parent_role_id ?? ""}
                    onChange={(e) => setParent(role, e.target.value)}
                    className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-brand-ring"
                  >
                    <option value="">— No hereda de nadie —</option>
                    {roles
                      .filter((r) => !blocked.has(r.id))
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                  </select>
                  {role.child_count > 0 && (
                    <p className="text-[11px] text-ink-muted mt-1.5">
                      {role.child_count} rol(es) heredan de éste: lo que toques acá
                      les llega también.
                    </p>
                  )}
                </div>

                {Object.entries(byDomain).map(([domain, entries]) => (
                  <div key={domain}>
                    <p className="text-[11px] font-bold text-ink-muted uppercase tracking-wider mb-1.5">
                      {DOMAIN_LABEL[domain] ?? domain}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {entries.map((entry) => {
                        const own = role.own_permissions.includes(entry.value);
                        const inherited = role.inherited_permissions.includes(entry.value);

                        // Heredada: se muestra pero no se apaga desde acá. Para
                        // sacarla hay que ir al rol de donde viene, que es
                        // justamente lo que heredar significa.
                        if (inherited) {
                          return (
                            <span
                              key={entry.value}
                              title={`Viene de ${role.parent_name} — para sacarla, editá ese rol`}
                              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-brand-soft text-brand border border-dashed border-brand/40 cursor-default"
                            >
                              {label(entry)}
                            </span>
                          );
                        }

                        return (
                          <button
                            key={entry.value}
                            onClick={() => toggle(role, entry.value)}
                            title={entry.value}
                            className={`pressable px-2.5 py-1 rounded-lg text-xs font-medium transition-colors duration-150 ${
                              own
                                ? "bg-brand text-white"
                                : "bg-surface-strong text-ink-muted hover:text-ink"
                            }`}
                          >
                            {label(entry)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {role.inherited_permissions.length > 0 && (
                  <p className="text-[11px] text-ink-faint">
                    Las de borde punteado vienen de {role.parent_name}.
                  </p>
                )}

                {!role.is_preset && (
                  <button
                    onClick={() => removeRole(role)}
                    className="pressable text-xs text-red-600 hover:text-red-700 bg-red-50 px-3 py-1.5 rounded-lg transition-colors duration-150"
                  >
                    Eliminar rol
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {creating ? (
        <div className="bg-surface rounded-xl p-4 space-y-2">
          <input
            autoFocus
            placeholder="Nombre del rol"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createRole()}
            className="w-full bg-surface-strong text-ink text-sm rounded-lg px-3 py-2 placeholder-ink-faint outline-none focus:ring-1 focus:ring-brand-ring"
          />
          <div className="flex gap-2">
            <button
              onClick={createRole}
              disabled={!newName.trim()}
              className="pressable text-sm bg-brand hover:bg-brand-hover disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium transition-colors duration-150"
            >
              Crear
            </button>
            <button
              onClick={() => { setCreating(false); setNewName(""); }}
              className="pressable text-sm text-ink-muted hover:text-ink px-4 py-2 rounded-lg"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="pressable w-full bg-surface hover:bg-surface-hover text-ink text-sm font-semibold py-2.5 rounded-xl transition-colors duration-150"
        >
          + Nuevo rol
        </button>
      )}
    </div>
  );
}
