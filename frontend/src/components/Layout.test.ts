/**
 * A qué llega cada persona.
 *
 * El menú pasó de armarse por el `role` del enum viejo a armarse por
 * capacidades. Eso cambia lo que ve **todo** usuario, así que acá quedan fijados
 * los menús de los roles que hoy existen: si alguien pierde una pantalla que
 * antes tenía, falla esto y no un socio del club un domingo.
 */
import { describe, expect, it } from "vitest";

import { navFor } from "./Layout";

/** Capacidades de los presets, tal como los siembra `core/permissions.py`. */
const READ_ONLY = [
  "plantel.ver",
  "asistencia.ver",
  "partido.ver",
  "medico.ver",
  "mediciones.ver",
];

const PRESET = {
  administrador: [
    ...READ_ONLY,
    "plantel.editar", "plantel.importar", "plantel.mover",
    "asistencia.cargar", "entrenamiento.gestionar",
    "partido.gestionar", "partido.timer", "partido.eventos", "partido.lineup",
    "medico.editar", "mediciones.cargar",
    "gimnasio.ver", "gimnasio.editar", "gimnasio.ver_propio",
    "socios.ver_todas", "socios.importar", "socios.ver_propia",
    "bolsa.ver", "bolsa.publicar", "bolsa.moderar",
    "club.usuarios", "club.divisiones", "club.torneos", "club.rivales",
    "club.ver_competencia", "nutricion.turnos_publicar", "nutricion.turnos_reservar",
  ],
  entrenador: [
    ...READ_ONLY,
    "asistencia.cargar", "entrenamiento.gestionar",
    "partido.timer", "partido.eventos", "mediciones.cargar", "gimnasio.ver",
    "club.ver_competencia",
  ],
  analista: [
    ...READ_ONLY, "partido.eventos", "asistencia.cargar", "mediciones.cargar",
    "club.ver_competencia",
  ],
  jugador: ["gimnasio.ver_propio", "nutricion.turnos_reservar"],
  socio: ["socios.ver_propia", "bolsa.ver", "bolsa.publicar", "club.ver_competencia"],
  tesorero: ["socios.ver_todas", "socios.importar"],
  preparadorFisico: [
    ...READ_ONLY, "mediciones.cargar", "gimnasio.ver", "gimnasio.editar",
  ],
  nutricionista: [...READ_ONLY, "mediciones.cargar", "nutricion.turnos_publicar"],
};

function labels(role: string | undefined, permissions: string[]): string[] {
  return navFor(role, permissions).flatMap((g) => g.items.map((i) => i.label));
}

describe("navFor", () => {
  it("el administrador llega a todo", () => {
    const items = labels("club_admin", PRESET.administrador);
    [
      "Hoy", "Calendario", "Partidos", "Estadísticas de partidos", "Plantel", "Asistencia",
      "Mediciones", "Gimnasio", "Socios", "Bolsa de trabajo", "Configuración",
      "Fixture", "Tablas", "Citados", "Nutrición", "Turno de nutrición", "Comunicados",
    ].forEach((l) => expect(items).toContain(l));
  });

  it("el entrenador conserva su menú y sigue sin ver la configuración del club", () => {
    const items = labels("match_director", PRESET.entrenador);
    expect(items).toEqual(
      expect.arrayContaining([
        "Hoy", "Calendario", "Partidos", "Estadísticas de partidos", "Plantel", "Asistencia",
        "Mediciones", "Gimnasio", "Fixture", "Tablas", "Citados", "Comunicados",
      ])
    );
    expect(items).not.toContain("Configuración");
    expect(items).not.toContain("Socios");
  });

  it("el analista ve lo mismo que el entrenador menos el gimnasio", () => {
    const items = labels("analyst", PRESET.analista);
    expect(items).toContain("Asistencia");
    expect(items).toContain("Estadísticas de partidos");
    expect(items).not.toContain("Gimnasio");
    expect(items).not.toContain("Configuración");
  });

  it("el jugador ve lo suyo y su turno de nutrición", () => {
    const items = labels("player", PRESET.jugador);
    expect(items).toEqual(
      expect.arrayContaining([
        "Mi ficha", "Tests", "Mediciones físicas", "Gimnasio",
        "Mis estadísticas", "Turno de nutrición",
      ])
    );
    expect(items).not.toContain("Nutrición");
  });

  it("el socio ve su cuota, la bolsa y el portal multidivisión, y nada del club", () => {
    const items = labels("player", PRESET.socio);
    expect(items).toContain("Mi cuota");
    expect(items).toContain("Bolsa de trabajo");
    expect(items).toContain("Fixture");
    expect(items).toContain("Tablas");
    expect(items).toContain("Citados");
    expect(items).not.toContain("Plantel");
    expect(items).not.toContain("Socios");
  });

  it("el tesorero llega al padrón sin ver nada del plantel", () => {
    const items = labels("analyst", PRESET.tesorero);
    expect(items).toContain("Socios");
    expect(items).not.toContain("Plantel");
    expect(items).not.toContain("Hoy");
  });

  it("el preparador físico llega al gimnasio", () => {
    expect(labels("analyst", PRESET.preparadorFisico)).toContain("Gimnasio");
  });

  it("la nutricionista llega a nutrición", () => {
    expect(labels("analyst", PRESET.nutricionista)).toContain("Nutrición");
  });

  // ── Lo que este cambio vino a arreglar ──────────────────────────────────────

  it("un jugador con rol de entrenador ve el menú de entrenador", () => {
    /*
      El caso que motivó pasar el menú a capacidades: antes la lista salía del
      `role` del enum, así que darle el rol Entrenador a alguien cargado como
      `player` le daba los permisos y ninguna forma de llegar a las pantallas.
    */
    const items = labels("player", PRESET.entrenador);
    expect(items).toContain("Plantel");
    expect(items).toContain("Asistencia");
    expect(items).toContain("Gimnasio");
  });

  it("un jugador que hereda de socio ve la bolsa y el portal multidivisión", () => {
    const items = labels("player", [...PRESET.jugador, ...PRESET.socio]);
    expect(items).toContain("Bolsa de trabajo");
    expect(items).toContain("Mi ficha");
    expect(items).toContain("Mi cuota");
    expect(items).toContain("Fixture");
  });

  // ── Bordes ─────────────────────────────────────────────────────────────────

  it("el superadmin ve sólo clubes, aunque tenga todas las capacidades", () => {
    // Las tiene todas, pero no tiene club: esas pantallas necesitan uno.
    expect(labels("superadmin", PRESET.administrador)).toEqual(["Clubes"]);
  });

  it("sin capacidades el menú queda vacío en vez de mostrar cosas que no abren", () => {
    expect(labels("analyst", [])).toEqual([]);
  });

  it("sin sesión no hay menú", () => {
    expect(labels(undefined, [])).toEqual([]);
  });

  it("alcanza con una de las capacidades de un ítem que acepta varias", () => {
    // Calendario junta entrenamientos y partidos: exigir las dos dejaría afuera
    // a quien tiene una sola razón legítima para entrar.
    expect(labels("analyst", ["partido.ver"])).toContain("Calendario");
    expect(labels("analyst", ["entrenamiento.gestionar"])).toContain("Calendario");
  });
});
