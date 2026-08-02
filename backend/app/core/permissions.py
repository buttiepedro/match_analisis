"""
Catálogo de capacidades y roles preset.

Las capacidades son constantes de código, no filas de una tabla: el conjunto lo
define el código —cada endpoint referencia una— así que una tabla agregaría un
join para almacenar algo que ya está fijo.

`superadmin` **no** participa de este sistema: crear clubes es una capacidad de la
plataforma y no pertenece a ningún club. Sigue siendo un chequeo directo sobre
`users.role`.
"""
import enum


class Permission(str, enum.Enum):
    """Capacidades, nombradas `dominio.acción`."""

    # Plantel
    plantel_ver = "plantel.ver"
    plantel_editar = "plantel.editar"
    plantel_mover = "plantel.mover"
    plantel_importar = "plantel.importar"

    # Entrenamientos y asistencia
    asistencia_ver = "asistencia.ver"
    asistencia_cargar = "asistencia.cargar"
    entrenamiento_gestionar = "entrenamiento.gestionar"

    # Partido
    partido_ver = "partido.ver"
    partido_gestionar = "partido.gestionar"
    partido_timer = "partido.timer"
    partido_eventos = "partido.eventos"
    partido_lineup = "partido.lineup"

    # Médico
    medico_ver = "medico.ver"
    medico_editar = "medico.editar"

    # Mediciones
    mediciones_ver = "mediciones.ver"
    mediciones_cargar = "mediciones.cargar"

    # Socios
    #: Ver el estado de cuota propio. La tiene el socio y nadie más la necesita.
    socios_ver_propia = "socios.ver_propia"
    socios_ver_todas = "socios.ver_todas"
    socios_importar = "socios.importar"

    # Gimnasio
    #: Ver el plan propio. La tiene el jugador y nadie más la necesita.
    gimnasio_ver_propio = "gimnasio.ver_propio"
    gimnasio_ver = "gimnasio.ver"
    gimnasio_editar = "gimnasio.editar"

    # Bolsa de trabajo
    bolsa_ver = "bolsa.ver"
    bolsa_publicar = "bolsa.publicar"
    bolsa_moderar = "bolsa.moderar"

    # Configuración del club
    club_divisiones = "club.divisiones"
    club_torneos = "club.torneos"
    club_usuarios = "club.usuarios"
    club_rivales = "club.rivales"

    # Portal — vistas de sólo lectura del club entero, sin alcance por división
    #: Fixture, tabla de posiciones y citados de **todas** las divisiones. No se
    #: filtra por división a propósito: quien la tiene ve el club entero.
    club_ver_competencia = "club.ver_competencia"


ALL_PERMISSIONS: frozenset[str] = frozenset(p.value for p in Permission)

#: Sólo lectura. Base de los roles que miran pero no tocan.
READ_ONLY: frozenset[str] = frozenset(
    {
        Permission.plantel_ver.value,
        Permission.asistencia_ver.value,
        Permission.partido_ver.value,
        Permission.medico_ver.value,
        Permission.mediciones_ver.value,
    }
)


# ── Roles preset ──────────────────────────────────────────────────────────────
#
# Los cuatro primeros reproducen **exactamente** lo que cada `UserRole` podía
# antes del cambio: el mapeo salió de medir los endpoints, no de suponerlos. Es
# lo que hace que nadie gane ni pierda acceso el día del deploy.

ADMINISTRADOR = "Administrador"
ENTRENADOR = "Entrenador"
ANALISTA = "Analista"
JUGADOR = "Jugador"
PREPARADOR_FISICO = "Preparador físico"
NUTRICIONISTA = "Nutricionista"
TESORERO = "Tesorero"
SOCIO = "Socio"

PRESET_PERMISSIONS: dict[str, frozenset[str]] = {
    # club_admin: podía todo dentro del club.
    ADMINISTRADOR: ALL_PERMISSIONS,
    # match_director: controlaba el timer y gestionaba entrenamientos, pero no
    # tocaba la configuración del club ni el parte médico.
    ENTRENADOR: READ_ONLY
    | {
        Permission.asistencia_cargar.value,
        Permission.entrenamiento_gestionar.value,
        Permission.partido_timer.value,
        Permission.partido_eventos.value,
        Permission.mediciones_cargar.value,
        Permission.gimnasio_ver.value,
        Permission.club_ver_competencia.value,
    },
    # analyst: registraba eventos y tomaba asistencia; nada más.
    ANALISTA: READ_ONLY
    | {
        Permission.partido_eventos.value,
        Permission.asistencia_cargar.value,
        Permission.mediciones_cargar.value,
        Permission.club_ver_competencia.value,
    },
    # player: ninguna capacidad sobre el club. No es un olvido — su acceso es a lo
    # propio, y eso lo resuelve `require_player_self`, que no es una capacidad.
    JUGADOR: frozenset({Permission.gimnasio_ver_propio.value}),
    # Los cuatro siguientes son nuevos: se siembran para que el club los complete
    # y **no se le asignan a nadie**. Adivinar quién es tesorero sería peor que
    # dejarlo sin asignar.
    # El PF escribe los planes: es su herramienta principal.
    PREPARADOR_FISICO: READ_ONLY
    | {
        Permission.mediciones_cargar.value,
        Permission.gimnasio_ver.value,
        Permission.gimnasio_editar.value,
    },
    NUTRICIONISTA: READ_ONLY | {Permission.mediciones_cargar.value},
    # Tesorero: ve el padrón entero y sincroniza contra el sistema contable.
    TESORERO: frozenset(
        {Permission.socios_ver_todas.value, Permission.socios_importar.value}
    ),
    # Socio: su estado de cuota y la bolsa de trabajo, que es un beneficio de
    # ser socio. Nada más del club.
    SOCIO: frozenset(
        {
            Permission.socios_ver_propia.value,
            Permission.bolsa_ver.value,
            Permission.bolsa_publicar.value,
            Permission.club_ver_competencia.value,
        }
    ),
}

#: Rol preset que le corresponde a cada valor del enum viejo. `superadmin` no
#: aparece: no es un rol de club.
LEGACY_ROLE_TO_PRESET: dict[str, str] = {
    "club_admin": ADMINISTRADOR,
    "match_director": ENTRENADOR,
    "analyst": ANALISTA,
    "player": JUGADOR,
}
