import { useEffect, useMemo, useState } from "react";
import api from "../lib/axios";
import { parseApiError } from "../lib/errors";

interface Role {
  id: string;
  name: string;
  is_preset: boolean;
  permissions: string[];
  user_count: number;
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
};

function label(entry: PermissionEntry): string {
  return ACTION_LABEL[entry.action] ?? entry.action;
}

export default function RolesTab({ clubId }: { clubId: string }) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [catalog, setCatalog] = useState<PermissionEntry[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const load = () => {
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
  };

  useEffect(load, [clubId]);

  const byDomain = useMemo(() => {
    const map: Record<string, PermissionEntry[]> = {};
    catalog.forEach((p) => {
      (map[p.domain] ??= []).push(p);
    });
    return map;
  }, [catalog]);

  const toggle = async (role: Role, permission: string) => {
    const next = role.permissions.includes(permission)
      ? role.permissions.filter((p) => p !== permission)
      : [...role.permissions, permission];

    // Optimista: marcar una capacidad tiene que sentirse inmediato.
    setRoles((prev) =>
      prev.map((r) => (r.id === role.id ? { ...r, permissions: next } : r))
    );
    setError("");
    try {
      const { data } = await api.patch<Role>(`/clubs/${clubId}/roles/${role.id}`, {
        permissions: next,
      });
      setRoles((prev) => prev.map((r) => (r.id === role.id ? data : r)));
    } catch (err) {
      setRoles((prev) => prev.map((r) => (r.id === role.id ? role : r)));
      setError(parseApiError(err, "No se pudo guardar el cambio"));
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
      setRoles((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
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
      setRoles((prev) => prev.filter((r) => r.id !== role.id));
    } catch (err) {
      // El backend explica por qué no se puede: preset, o asignado a gente.
      setError(parseApiError(err, "No se pudo eliminar el rol"));
    }
  };

  if (loading) {
    return <p className="text-ink-muted text-sm py-8 text-center">Cargando roles...</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-muted">
        Un usuario puede tener varios roles y sus permisos se suman. Los roles del
        sistema se pueden editar pero no eliminar.
      </p>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}

      {roles.map((role) => {
        const open = editing === role.id;
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
                {Object.entries(byDomain).map(([domain, entries]) => (
                  <div key={domain}>
                    <p className="text-[11px] font-bold text-ink-muted uppercase tracking-wider mb-1.5">
                      {DOMAIN_LABEL[domain] ?? domain}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {entries.map((entry) => {
                        const on = role.permissions.includes(entry.value);
                        return (
                          <button
                            key={entry.value}
                            onClick={() => toggle(role, entry.value)}
                            title={entry.value}
                            className={`pressable px-2.5 py-1 rounded-lg text-xs font-medium transition-colors duration-150 ${
                              on
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
