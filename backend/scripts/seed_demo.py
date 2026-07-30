#!/usr/bin/env python3
"""
Crea un club de demostración con datos en todos los módulos.

    python scripts/seed_demo.py --url https://tu-backend.up.railway.app

Las credenciales del superadmin salen de `SEED_SUPERADMIN_EMAIL` y
`SEED_SUPERADMIN_PASSWORD`, y si no están se preguntan por consola. **Por
argumento no**, a propósito: lo que se escribe en la línea de comandos queda en
el historial del shell y en la lista de procesos de la máquina.

Trabaja **por la API pública**, con el mismo login que usaría una persona. No se
conecta a la base ni firma tokens: si un endpoint valida algo, esto lo respeta.
El efecto secundario útil es que ejercita la API de punta a punta — más de una
vez el seed encontró antes que un test que a un endpoint le faltaba algo.

Es **idempotente por nombre de club**: si el club Demo ya existe, no crea otro;
avisa y sale. Para rehacerlo hay que borrarlo primero.
"""
from __future__ import annotations

import argparse
import getpass
import os
import random
import sys
from datetime import date, datetime, timedelta, timezone
from typing import Any

try:
    import httpx
except ImportError:  # pragma: no cover
    sys.exit("Falta httpx. Instalalo con: pip install httpx")

CLUB_NAME = "Demo"
ADMIN_EMAIL = "club@demo.com"
ADMIN_PASSWORD = "123456"

#: Semilla fija: dos corridas dan el mismo club. Un demo que cambia cada vez que
#: se rearma es un demo que no se puede usar para explicarle nada a nadie.
random.seed(20260729)

POSITIONS = [
    "Pilar izquierdo", "Hooker", "Pilar derecho", "Segunda línea", "Segunda línea",
    "Ala ciego", "Ala abierto", "Octavo", "Medio scrum", "Apertura",
    "Wing izquierdo", "Primer centro", "Segundo centro", "Wing derecho", "Fullback",
]

NOMBRES = [
    "Bautista", "Ignacio", "Tomás", "Santiago", "Joaquín", "Facundo", "Mateo",
    "Lucas", "Franco", "Agustín", "Juan Cruz", "Nicolás", "Manuel", "Federico",
    "Gonzalo", "Pedro", "Emiliano", "Valentín", "Ramiro", "Julián", "Martín",
    "Lautaro", "Benjamín", "Tobías",
]
APELLIDOS = [
    "Gómez", "Fernández", "López", "Martínez", "Rodríguez", "Pérez", "Sánchez",
    "Romero", "Álvarez", "Torres", "Ruiz", "Ramírez", "Flores", "Benítez",
    "Acosta", "Medina", "Herrera", "Aguirre", "Molina", "Silva", "Castro",
    "Ortiz", "Núñez", "Ríos",
]


class Api:
    """Cliente mínimo. Cada error trae el cuerpo de la respuesta: sin eso, depurar un seed es a ciegas."""

    def __init__(self, base: str, token: str = ""):
        self.base = base.rstrip("/")
        self.token = token
        self.http = httpx.Client(timeout=60.0)

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"} if self.token else {}

    def call(self, method: str, path: str, *, json: Any = None, params: Any = None) -> Any:
        res = self.http.request(
            method, f"{self.base}{path}", json=json, params=params, headers=self._headers()
        )
        if res.status_code >= 400:
            raise RuntimeError(f"{method} {path} → {res.status_code}: {res.text[:400]}")
        return res.json() if res.content else None

    def get(self, path: str, **kw) -> Any:
        return self.call("GET", path, **kw)

    def post(self, path: str, **kw) -> Any:
        return self.call("POST", path, **kw)

    def put(self, path: str, **kw) -> Any:
        return self.call("PUT", path, **kw)

    def patch(self, path: str, **kw) -> Any:
        return self.call("PATCH", path, **kw)


def login(api: Api, email: str, password: str) -> str:
    data = api.post("/auth/login", json={"email": email, "password": password})
    return data["access_token"]


def paso(texto: str) -> None:
    print(f"  {texto}", flush=True)


# ── El club ───────────────────────────────────────────────────────────────────

def crear_club(root: Api) -> dict:
    existentes = root.get("/clubs")
    ya = next((c for c in existentes if c["name"] == CLUB_NAME), None)
    if ya:
        print(
            f"\nYa existe un club '{CLUB_NAME}'. No se toca nada.\n"
            "Para rehacerlo, borralo primero desde la pantalla de Clubes."
        )
        sys.exit(0)

    club = root.post(
        "/clubs",
        json={
            "name": CLUB_NAME,
            "admin_email": ADMIN_EMAIL,
            "admin_password": ADMIN_PASSWORD,
            "admin_full_name": "Administrador Demo",
        },
    )
    paso(f"club '{CLUB_NAME}' creado · admin {ADMIN_EMAIL}")
    return club


def crear_usuarios(api: Api, club_id: str) -> dict[str, dict]:
    """
    Un usuario por rol, para poder mostrar cómo se ve la app desde cada lugar.

    Es la mitad más difícil de explicar del producto: tres usuarios que no se
    pisan. Con un solo login no se puede mostrar.
    """
    plantilla = [
        ("entrenador@demo.com", "Entrenador Demo", "match_director", "Entrenador"),
        ("analista@demo.com", "Analista Demo", "analyst", "Analista"),
        ("pf@demo.com", "Preparador Físico Demo", "analyst", "Preparador físico"),
        ("nutri@demo.com", "Nutricionista Demo", "analyst", "Nutricionista"),
        ("tesorero@demo.com", "Tesorero Demo", "analyst", "Tesorero"),
    ]

    roles = {r["name"]: r for r in api.get(f"/clubs/{club_id}/roles")}
    creados: dict[str, dict] = {}

    for email, nombre, legacy, preset in plantilla:
        user = api.post(
            f"/clubs/{club_id}/users",
            json={
                "email": email,
                "password": ADMIN_PASSWORD,
                "full_name": nombre,
                "role": legacy,
            },
        )
        rol = roles.get(preset)
        if rol:
            api.put(
                f"/clubs/{club_id}/users/{user['id']}/roles", json={"role_ids": [rol["id"]]}
            )
        creados[preset] = user

    paso(f"{len(creados)} usuarios, uno por rol · contraseña {ADMIN_PASSWORD}")
    return creados


def encadenar_roles(api: Api, club_id: str) -> None:
    """
    Deja armada la herencia, que es lo que hay que *ver* para entenderla.

    Jugador y Entrenador heredan de Socio: quien mire la pantalla de roles ve la
    cadena y las capacidades heredadas con borde punteado, en vez de una
    explicación.
    """
    roles = {r["name"]: r for r in api.get(f"/clubs/{club_id}/roles")}
    socio = roles.get("Socio")
    if not socio:
        return

    for nombre in ("Jugador", "Entrenador"):
        rol = roles.get(nombre)
        if rol:
            api.patch(
                f"/clubs/{club_id}/roles/{rol['id']}", json={"parent_role_id": socio["id"]}
            )
    paso("Jugador y Entrenador heredan de Socio")


# ── Plantel ───────────────────────────────────────────────────────────────────

def crear_divisiones(api: Api, club_id: str) -> dict[str, str]:
    divisiones = {}
    for nombre in ("Primera", "Intermedia", "M19", "M17"):
        div = api.post(f"/clubs/{club_id}/divisions", json={"name": nombre})
        divisiones[nombre] = div["id"]
    paso(f"{len(divisiones)} divisiones: {', '.join(divisiones)}")
    return divisiones


def crear_plantel(api: Api, divisiones: dict[str, str]) -> dict[str, list[dict]]:
    """Planteles de tamaño creíble: 26 en Primera, menos en las formativas."""
    tamanos = {"Primera": 26, "Intermedia": 22, "M19": 20, "M17": 18}
    dni = 30_000_000
    plantel: dict[str, list[dict]] = {}

    for division, cantidad in tamanos.items():
        jugadores = []
        for i in range(cantidad):
            dni += random.randint(1000, 9000)
            nacimiento = {
                "Primera": date(1996, 1, 1),
                "Intermedia": date(1999, 1, 1),
                "M19": date(2007, 1, 1),
                "M17": date(2009, 1, 1),
            }[division] + timedelta(days=random.randint(0, 1000))

            jugador = api.post(
                f"/divisions/{divisiones[division]}/players",
                json={
                    "name": f"{random.choice(APELLIDOS)} {random.choice(NOMBRES)}",
                    "position": POSITIONS[i % len(POSITIONS)],
                    "dni": str(dni),
                    "date_of_birth": nacimiento.isoformat(),
                    "sex": "M",
                    "email": f"jugador{i + 1}.{division.lower()}@demo.com",
                    "phone": f"11-5{random.randint(100, 999)}-{random.randint(1000, 9999)}",
                    "emergency_phone": f"11-4{random.randint(100, 999)}-{random.randint(1000, 9999)}",
                    "obra_social": random.choice(["OSDE", "Swiss Medical", "Galeno", "PAMI", None]),
                },
            )
            jugadores.append(jugador)
        plantel[division] = jugadores

    total = sum(len(v) for v in plantel.values())
    paso(f"{total} jugadores en total")
    return plantel


def cargar_mediciones(api: Api, plantel: dict[str, list[dict]]) -> None:
    """
    Tres mediciones por jugador, espaciadas: una sola no dibuja una evolución, y
    la pantalla de peso es justamente un gráfico en el tiempo.
    """
    hoy = date.today()
    mediciones = tests = 0

    for jugadores in plantel.values():
        for jugador in jugadores:
            base_peso = random.uniform(72, 118)
            altura = random.uniform(168, 196)

            for meses_atras in (5, 3, 1):
                cuando = hoy - timedelta(days=meses_atras * 30)
                api.post(
                    f"/players/{jugador['id']}/measurements",
                    json={
                        "measured_at": cuando.isoformat(),
                        "weight_kg": round(base_peso + random.uniform(-2.5, 2.5), 1),
                        "height_cm": round(altura, 1),
                        "fat_fold_tricep_mm": round(random.uniform(6, 18), 1),
                        "fat_fold_subscapular_mm": round(random.uniform(8, 22), 1),
                        "fat_fold_suprailiac_mm": round(random.uniform(8, 24), 1),
                        "fat_fold_abdominal_mm": round(random.uniform(10, 28), 1),
                    },
                )
                mediciones += 1

            # Los 3RM van a todos: son los que el plan de gimnasio usa para
            # resolver los kilos de cada uno. Sin ellos el plan muestra "te falta
            # el test", que es correcto pero no sirve para mostrar el módulo.
            catalogo = [
                ("cmj", random.uniform(38, 62)),
                ("bronco", random.uniform(280, 360)),
                ("bench_3rm", random.uniform(70, 135)),
                ("squat_3rm", random.uniform(100, 195)),
                ("sprint_40m", random.uniform(5.0, 6.4)),
            ]
            for test_type, valor in catalogo:
                api.post(
                    f"/players/{jugador['id']}/tests",
                    json={
                        "test_date": (hoy - timedelta(days=random.randint(10, 60))).isoformat(),
                        "test_type": test_type,
                        "value": round(valor, 1),
                    },
                )
                tests += 1

    paso(f"{mediciones} mediciones antropométricas y {tests} tests físicos")


def cargar_lesiones(api: Api, plantel: dict[str, list[dict]]) -> None:
    """Unas pocas, y mezcladas: activas y recuperadas, o el parte médico se ve vacío."""
    zonas = ["Rodilla", "Hombro", "Isquiotibial", "Tobillo", "Cabeza", "Mano"]
    tipos = ["Esguince", "Distensión", "Contusión", "Luxación", "Conmoción"]
    hoy = date.today()
    total = 0

    for jugadores in plantel.values():
        for jugador in random.sample(jugadores, k=min(3, len(jugadores))):
            fecha = hoy - timedelta(days=random.randint(5, 120))
            recuperado = random.random() < 0.5
            api.post(
                f"/players/{jugador['id']}/injuries",
                json={
                    "injury_date": fecha.isoformat(),
                    "body_zone": random.choice(zonas),
                    "injury_type": random.choice(tipos),
                    "severity": random.choice(["leve", "moderada", "grave"]),
                    "expected_return": (fecha + timedelta(days=random.randint(7, 60))).isoformat(),
                    "actual_return": (
                        (fecha + timedelta(days=random.randint(7, 50))).isoformat()
                        if recuperado
                        else None
                    ),
                    "notes": "Carga de demostración.",
                },
            )
            total += 1

    paso(f"{total} lesiones, algunas activas y otras recuperadas")


# ── Semana a semana ───────────────────────────────────────────────────────────

def cargar_entrenamientos(api: Api, divisiones: dict[str, str], plantel: dict[str, list[dict]]) -> None:
    """
    Ocho semanas de martes y jueves con asistencia cargada.

    Con menos no se ve una tendencia, y la pantalla de asistencia existe para
    mostrar quién se está cayendo del plantel.
    """
    hoy = date.today()
    entrenamientos = presencias = 0

    for division, division_id in divisiones.items():
        jugadores = plantel[division]
        # Cada jugador tiene su propia constancia: sin eso, la asistencia sale
        # toda igual y no hay nada que mirar.
        constancia = {j["id"]: random.uniform(0.55, 0.98) for j in jugadores}

        for semana in range(8, 0, -1):
            for dia_semana in (1, 3):  # martes y jueves
                fecha = hoy - timedelta(days=semana * 7)
                fecha += timedelta(days=(dia_semana - fecha.weekday()) % 7)
                if fecha > hoy:
                    continue

                training = api.post(
                    f"/divisions/{division_id}/trainings",
                    json={
                        "date": fecha.isoformat(),
                        "type": "entrenamiento" if dia_semana == 1 else "fisico",
                    },
                )
                entrenamientos += 1

                entries = []
                for jugador in jugadores:
                    sorteo = random.random()
                    if sorteo < constancia[jugador["id"]]:
                        estado = "presente"
                        presencias += 1
                    elif sorteo < constancia[jugador["id"]] + 0.08:
                        estado = "tarde"
                    elif sorteo < constancia[jugador["id"]] + 0.16:
                        estado = "justificado"
                    else:
                        estado = random.choice(["ausente", "lesionado"])
                    entries.append({"player_id": jugador["id"], "status": estado})

                api.put(f"/trainings/{training['id']}/attendance", json={"entries": entries})

    paso(f"{entrenamientos} entrenamientos con asistencia ({presencias} presentes)")


def cargar_gimnasio(api: Api, divisiones: dict[str, str]) -> None:
    """
    Un plan con carga **relativa a los 3RM**, que es lo que hace útil al módulo:
    el PF escribe un plan y cada jugador ve sus kilos.
    """
    for division, division_id in divisiones.items():
        plan = api.post(
            f"/divisions/{division_id}/gym-plans",
            json={
                "name": f"Pretemporada {division}",
                "weeks": 4,
                "notes": "Plan de demostración con cargas relativas a los 3RM.",
                "is_active": True,
            },
        )

        dias = []
        for semana in range(1, 5):
            porcentaje = 65 + (semana - 1) * 5
            dias.append({
                "week": semana,
                "day": 1,
                "name": "Tren inferior",
                "exercises": [
                    {"name": "Sentadilla", "sets": 4, "reps": "5",
                     "load_type": "porcentaje_test", "load_value": porcentaje,
                     "load_test_type": "squat_3rm"},
                    {"name": "Peso muerto rumano", "sets": 3, "reps": "8",
                     "load_type": "absoluta", "load_value": 60},
                    {"name": "Estocadas", "sets": 3, "reps": "10 por pierna", "load_type": "libre"},
                ],
            })
            dias.append({
                "week": semana,
                "day": 2,
                "name": "Tren superior",
                "exercises": [
                    {"name": "Press banca", "sets": 4, "reps": "5",
                     "load_type": "porcentaje_test", "load_value": porcentaje,
                     "load_test_type": "bench_3rm"},
                    {"name": "Remo con barra", "sets": 4, "reps": "8",
                     "load_type": "absoluta", "load_value": 50},
                    {"name": "Dominadas", "sets": 3, "reps": "8-10", "load_type": "libre"},
                ],
            })

        api.put(f"/gym-plans/{plan['id']}/structure", json={"days": dias})

    paso(f"{len(divisiones)} planes de gimnasio activos, con cargas por % de 3RM")


# ── Partidos ──────────────────────────────────────────────────────────────────

def cargar_partidos(api: Api, club_id: str, divisiones: dict[str, str], plantel: dict[str, list[dict]]) -> None:
    rivales = ["Los Tilos", "San Luis", "La Plata RC", "Universitario", "Regatas"]
    for nombre in rivales:
        api.post(f"/clubs/{club_id}/opponents", json={"name": nombre})

    hoy = datetime.now(timezone.utc)
    partidos = eventos = 0

    for division, division_id in divisiones.items():
        torneo = api.post(
            f"/clubs/{club_id}/tournaments",
            json={"name": f"Torneo Regional {division}", "division_id": division_id,
                  "season": str(hoy.year)},
        )

        for i, rival in enumerate(rivales[:3]):
            cuando = hoy - timedelta(days=(3 - i) * 7)
            session = api.post(
                f"/tournaments/{torneo['id']}/sessions",
                json={
                    "home_team": CLUB_NAME,
                    "away_team": rival,
                    "scheduled_at": cuando.isoformat(),
                    "half_duration_minutes": 40,
                },
            )
            partidos += 1

            convocados = random.sample(plantel[division], k=min(23, len(plantel[division])))
            api.put(
                f"/sessions/{session['id']}/squad",
                json={"entries": [{"player_id": j["id"]} for j in convocados]},
            )

            # Eventos repartidos en los dos tiempos, con los tipos que las
            # pantallas de estadística saben leer. Inventar nombres acá no daría
            # error —`event_type` es texto libre— pero las pantallas mostrarían
            # cero, que es la peor forma de fallar: parece que la app no anda.
            #
            # `team` es "user" o "rival": propio o del rival, no local o visitante.
            juego = [
                "tackle_effective", "tackle_missed", "tackle_positive",
                "line_break", "offload", "possession_lost", "ball_won",
            ]
            #: Estos llevan `obtained` en metadata: es lo que la pantalla cuenta
            #: para sacar el porcentaje de obtención.
            formaciones = [
                "lineout_favor", "lineout_against",
                "scrum_favor", "scrum_against",
                "exit_favor", "exit_against",
            ]

            for _ in range(random.randint(45, 70)):
                jugador = random.choice(convocados)
                api.post(
                    f"/sessions/{session['id']}/events",
                    json={
                        "event_type": random.choice(juego),
                        "team": random.choice(["user", "rival"]),
                        "player_id": jugador["id"],
                        "half": random.choice([1, 2]),
                        "timer_seconds": random.randint(0, 2400),
                    },
                )
                eventos += 1

            for _ in range(random.randint(12, 20)):
                api.post(
                    f"/sessions/{session['id']}/events",
                    json={
                        "event_type": random.choice(formaciones),
                        "team": "user",
                        "half": random.choice([1, 2]),
                        "timer_seconds": random.randint(0, 2400),
                        "metadata": {"obtained": random.random() < 0.75},
                    },
                )
                eventos += 1

            # Unos tries y penales, o el marcador queda en cero y el partido no
            # parece un partido.
            for _ in range(random.randint(2, 5)):
                api.post(
                    f"/sessions/{session['id']}/events",
                    json={
                        "event_type": "try",
                        "team": random.choice(["user", "user", "rival"]),
                        "player_id": random.choice(convocados)["id"],
                        "half": random.choice([1, 2]),
                        "timer_seconds": random.randint(0, 2400),
                    },
                )
                eventos += 1
            for _ in range(random.randint(2, 4)):
                api.post(
                    f"/sessions/{session['id']}/events",
                    json={
                        "event_type": "penalty",
                        "team": random.choice(["user", "rival"]),
                        "half": random.choice([1, 2]),
                        "timer_seconds": random.randint(0, 2400),
                        "reason": random.choice(["line", "scrum", "juega", "a_los_palos"]),
                    },
                )
                eventos += 1

    paso(f"{partidos} partidos con plantel convocado y {eventos} eventos cargados")


# ── Socios y bolsa ────────────────────────────────────────────────────────────

def cargar_socios(api: Api, club_id: str) -> None:
    """
    Socios con y sin la cuota al día: la pantalla del tesorero tiene un filtro de
    morosos, y con todos al día no se ve para qué sirve.
    """
    gente = [
        ("28111222", "Gómez Roberto", "activo", True),
        ("29333444", "Fernández Marta", "activo", True),
        ("30555666", "López Daniel", "activo", False),
        ("31777888", "Martínez Silvia", "vitalicio", True),
        ("32999000", "Rodríguez Carlos", "activo", False),
        ("33111333", "Pérez Ana", "cadete", True),
        ("34222444", "Sánchez Luis", "activo", True),
        ("35333555", "Romero Julieta", "activo", False),
    ]
    for i, (dni, nombre, categoria, al_dia) in enumerate(gente, start=1):
        api.post(
            f"/clubs/{club_id}/members",
            json={
                "document_id": dni,
                "full_name": nombre,
                "category": categoria,
                "member_number": f"{1000 + i}",
                "dues_up_to_date": al_dia,
                "default_password": ADMIN_PASSWORD,
            },
        )

    morosos = sum(1 for *_, al_dia in gente if not al_dia)
    paso(f"{len(gente)} socios ({morosos} con la cuota atrasada) · entran con DNI")


def cargar_bolsa(api: Api, club_id: str, admin_api: Api) -> None:
    """
    Avisos en los tres estados —publicado, pendiente, rechazado— para que se vea
    la moderación y no sólo el resultado.
    """
    avisos = [
        {
            "kind": "ofrece",
            "title": "Se busca electricista matriculado",
            "description": (
                "## Qué necesitamos\n"
                "Instalación completa en un local a estrenar de **90 m²** en el centro.\n\n"
                "- Tablero nuevo con disyuntor y térmicas\n"
                "- 14 bocas de luz y 20 tomas\n"
                "- Certificado de obra al terminar\n\n"
                "## Condiciones\n"
                "Trabajo por **quincena**, se paga contra avance. Materiales aparte.\n\n"
                "Somos socios del club desde 2011 🔧"
            ),
            "contact": "11-5555-1234 · roberto@demo.com",
            "publicar": True,
        },
        {
            "kind": "busca",
            "title": "Albañil con herramientas propias",
            "description": (
                "Hago **revoques, contrapisos y cerámicos**. 12 años de oficio.\n\n"
                "1. Presupuesto sin cargo\n"
                "2. Empiezo en la semana\n"
                "3. Dejo la obra limpia\n\n"
                "Trabajo por metro o por jornal, como les quede mejor. 🧱"
            ),
            "contact": "11-4444-9876",
            "publicar": True,
        },
        {
            "kind": "ofrece",
            "title": "Administrativa media jornada",
            "description": (
                "## El puesto\n"
                "Facturación y atención al cliente, **lunes a viernes de 9 a 13**.\n\n"
                "- Manejo de Excel\n"
                "- Experiencia previa en facturación\n"
                "- Zona: a diez cuadras del club\n\n"
                "Se ofrece relación de dependencia desde el primer día."
            ),
            "contact": "rrhh@demo.com",
            "publicar": True,
        },
        {
            "kind": "busca",
            "title": "Fletes y mudanzas los fines de semana",
            "description": "Camioneta cerrada, hasta **1.200 kg**. Sábados y domingos. 🚚",
            "contact": "11-6666-2222",
            "publicar": False,  # queda pendiente, para mostrar la cola
        },
        {
            "kind": "busca",
            "title": "Clases de apoyo",
            "description": "Matemática y física, secundario.",
            "contact": "consultar",
            "rechazar": "Poné un teléfono o un mail: 'consultar' no le sirve a nadie.",
        },
    ]

    for aviso in avisos:
        post = api.post(
            f"/clubs/{club_id}/job-posts",
            json={
                "kind": aviso["kind"],
                "title": aviso["title"],
                "description": aviso["description"],
                "contact": aviso["contact"],
            },
        )
        if aviso.get("publicar"):
            admin_api.post(f"/job-posts/{post['id']}/moderate", json={"approve": True})
        elif aviso.get("rechazar"):
            admin_api.post(
                f"/job-posts/{post['id']}/moderate",
                json={"approve": False, "note": aviso["rechazar"]},
            )

    paso(f"{len(avisos)} avisos en la bolsa: publicados, uno pendiente y uno rechazado")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Crea el club Demo con datos de prueba.")
    parser.add_argument("--url", required=True, help="Base del backend, ej: https://api.tuclub.com")
    args = parser.parse_args()

    print(f"\nBackend: {args.url}", flush=True)

    # Del entorno si están, y si no se preguntan. Del entorno porque es como se
    # corre en un shell de Railway, donde ya están definidas; y porque `getpass`
    # en Windows lee de la consola y no de stdin, así que sin esto el script no
    # se puede correr de forma desatendida ni probar.
    #
    # Por argumento de línea de comandos **no**: eso queda en el historial del
    # shell y en la lista de procesos de la máquina.
    email = os.environ.get("SEED_SUPERADMIN_EMAIL", "").strip()
    password = os.environ.get("SEED_SUPERADMIN_PASSWORD", "")

    if not (email and password):
        print("Credenciales del superadmin (SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD):", flush=True)
        email = email or input("  email: ").strip()
        password = password or getpass.getpass("  contraseña: ")

    root = Api(args.url)
    try:
        root.token = login(root, email, password)
    except RuntimeError as exc:
        sys.exit(f"\nNo se pudo entrar como superadmin.\n{exc}")

    print("\nCreando el club Demo...\n")

    club = crear_club(root)
    club_id = club["id"]

    # De acá en adelante se trabaja como el admin del club, no como superadmin:
    # es el rol que un club usa de verdad, así que el seed también prueba que
    # alcance para todo lo que sigue.
    admin = Api(args.url, login(root, ADMIN_EMAIL, ADMIN_PASSWORD))

    crear_usuarios(admin, club_id)
    encadenar_roles(admin, club_id)

    divisiones = crear_divisiones(admin, club_id)
    plantel = crear_plantel(admin, divisiones)
    cargar_mediciones(admin, plantel)
    cargar_lesiones(admin, plantel)
    cargar_entrenamientos(admin, divisiones, plantel)
    cargar_gimnasio(admin, divisiones)
    cargar_partidos(admin, club_id, divisiones, plantel)
    cargar_socios(admin, club_id)
    cargar_bolsa(admin, club_id, admin)

    print(f"""
Listo.

  Club:  {CLUB_NAME}
  Entrá: {ADMIN_EMAIL} / {ADMIN_PASSWORD}

  Otros logins, misma contraseña:
    entrenador@demo.com   entrenador
    analista@demo.com     analista
    pf@demo.com           preparador físico
    nutri@demo.com        nutricionista
    tesorero@demo.com     tesorero

  Los socios entran con su DNI y la misma contraseña. Los ves en Socios.

Ojo: {ADMIN_PASSWORD} es una contraseña de demo. Si este backend es el mismo que
usa el club de verdad, este login queda abierto para cualquiera que lo adivine.
""")


if __name__ == "__main__":
    main()
