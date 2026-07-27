---
title: Plataforma del club — roadmap de permisos, socios, bolsa de trabajo y gimnasio
type: roadmap
status: proposed
created: 2026-07-27
---

# Plataforma del club — roadmap

## De qué se trata este cambio de rumbo

Hasta acá el producto fue **una app de rugby**: estadísticas de partido, plantel,
asistencia, armado de equipo. Todos sus usuarios son gente del club trabajando sobre
jugadores.

Socios, cuotas y bolsa de trabajo **no tienen nada que ver con rugby**. Son features
de *club*. Eso cambia tres cosas de fondo, y conviene decirlas antes de escribir una
línea:

1. **Aparece un usuario que no juega ni entrena.** Un socio puede no pisar nunca una
   cancha. Hoy el único no-staff que existe es `player`, y está atado a una división.
2. **El modelo de permisos deja de alcanzar.** `require_club_admin` guarda **48
   endpoints**: crear divisiones, cargar lesiones, invitar jugadores, definir lineup.
   Es un cajón único. Meterle tesorería y moderación de avisos lo vuelve inservible.
3. **Entra la plata.** Una cuota es un registro contable: necesita auditoría, no admite
   borrado físico y alguien va a pedir conciliarla con el banco.

Este documento es el **programa**, no un cambio. Propone cinco cambios, en orden, con
la razón del orden. Cada uno se escribe como su propia propuesta cuando le toque.

---

## El modelo de personas que falta

Hoy: `User` es la cuenta, y `players.user_id` la ata a una ficha deportiva.

Eso no representa a un club real, donde la misma persona es varias cosas a la vez:
el entrenador de M17 que además es socio; el socio cuyo hijo juega en cadetes; el
jugador de Primera que también paga cuota.

**Propuesta**: `User` es la **cuenta**. De ella cuelgan perfiles, todos opcionales.

```
User (cuenta: email + password + roles)
 ├── Member  (socio)    → cuotas, bolsa de trabajo
 └── Player  (jugador)  → ficha deportiva, tests, plan de gimnasio
```

- Un socio que no juega: `User` + `Member`.
- Un jugador que no es socio: `User` + `Player`.
- La mayoría del plantel: `Player` **sin** `User` — nunca se le da acceso, y eso está bien.
- Staff: `User` sin ninguno de los dos.

`Player.member_id` nullable conecta los dos perfiles cuando son la misma persona.

> **Alternativa descartada**: una tabla `Person` central con todo colgando. Es más
> "correcta" y agrega un join a cada consulta del sistema para resolver un problema que
> dos FK nullables ya resuelven.

---

## Los cinco cambios, en orden

### 1. Permisos por capacidades — *primero, y no es negociable*

Todo lo demás lo necesita. Si los módulos nuevos llegan antes, cada uno suma un valor
al enum `UserRole` y el problema se hace más caro de arreglar con cada semana.

**De rol fijo a capacidad:**

| Hoy | Propuesta |
|-----|-----------|
| `UserRole` enum de 5 valores | Tabla `roles` por club |
| Un rol por usuario | `user_roles` many-a-muchos: el entrenador *también* es socio |
| `require_club_admin` en 48 endpoints | `require("asistencia.cargar")` — lo que el endpoint hace de verdad |

**Capacidades** como constantes tipo `dominio.acción`:

```
plantel.ver        plantel.editar        plantel.mover
asistencia.ver     asistencia.cargar
partido.timer      partido.eventos       partido.lineup
medico.ver         medico.editar
cuotas.ver_propia  cuotas.ver_todas      cuotas.registrar_pago
bolsa.ver          bolsa.publicar        bolsa.moderar
gimnasio.ver_propio gimnasio.asignar     gimnasio.editar_plan
club.usuarios      club.configuracion
```

**Roles preset** que se crean junto al club, para que nadie configure de cero:
Administrador · Entrenador · Analista · Preparador físico · Nutricionista · Tesorero ·
Socio · Jugador.

**La regla que hace segura la migración**: cada `UserRole` actual se mapea a un rol
preset con **exactamente** las capacidades que ya tenía. Nadie gana ni pierde acceso
el día del deploy. Es el mismo criterio que hizo segura la migración de alcance por
división ([[club-operativo]]): lo nuevo se opta, no se impone.

El alcance por división sigue siendo **ortogonal** y ya funciona: una capacidad dice
*qué* podés hacer, el alcance dice *sobre qué divisiones*.

---

### 2. Socios y cuotas — *el que más valor le da al club*

```
members          club_id, user_id?, nombre, dni, categoría, fecha_alta, estado
fee_schedules    club_id, categoría, monto, vigente_desde
fees             member_id, período (YYYY-MM), monto, estado, paid_at, método, registrado_por
```

Categorías: activo, cadete, vitalicio, adherente. Estados de cuota: pendiente, pagada,
exenta, vencida.

**Lo que ve el socio**: al día, o cuántos meses debe y desde cuándo. Nada más.
Es la pregunta que hace y hoy sólo se responde llamando por teléfono.

**Decisión de alcance que conviene tomar ahora**: la app **registra** pagos, no los
**cobra**. Un gateway trae PCI, conciliación, contracargos y devoluciones — es un
proyecto propio, no una fase de este. Se deja preparado el campo `método` para cuando
llegue.

**Porque es plata:**
- Las cuotas no se borran nunca; se anulan con motivo y queda quién y cuándo.
- Toda escritura queda auditada.
- La generación mensual es idempotente: correrla dos veces no duplica la cuota de mayo.

---

### 3. Portal del jugador ampliado — *el más barato de todo el roadmap*

El portal ya existe y muestra asistencia y temporada. Falta lo que el jugador más
quiere ver y **ya está en la base**:

- Sus **tests físicos** con evolución por categoría (Potencia, Resistencia, Fuerza).
- Su **antropometría**: peso y % de grasa en el tiempo.
- Su **posición en el ranking** de la división — opcional por club: motiva a algunos
  y expone a otros, así que lo decide el club, no el default.

Casi todo es UI sobre endpoints existentes. Va temprano porque es lo que hace que el
jugador *entre* a la app, y sin eso los módulos siguientes no tienen público.

---

### 4. Plan de gimnasio

```
gym_plans      club_id, nombre, división?, semanas, creado_por
gym_days       plan_id, semana, día, nombre
gym_exercises  day_id, ejercicio, series, reps, carga_tipo, carga_valor
gym_logs       player_id, day_id, fecha, completado, notas, rpe?
```

**La decisión que hace valioso el módulo**: la carga puede ser absoluta (80 kg) o
**relativa a un test del jugador** (`75% de Sentadilla 3RM`). Los 3RM se agregaron al
catálogo en [[club-operativo]] justamente para esto.

Con carga relativa, el PF escribe **un** plan para la división y cada jugador ve sus
kilos, calculados de su propio test. Sin eso, personalizar exige cargar el plan
jugador por jugador y nadie lo hace dos veces.

`gym_logs` da **adherencia al gimnasio**, que es a la sala de pesas lo que la
asistencia es al entrenamiento — y se cruza igual contra minutos jugados.

---

### 5. Bolsa de trabajo — *el más independiente*

```
job_posts  club_id, autor_user_id, tipo (ofrece|busca), título, descripción,
           contacto, categoría, estado, published_at, expires_at
```

Flujo: un socio publica → queda `pendiente` → alguien con `bolsa.moderar` la aprueba.

**Dos decisiones que definen si se usa o se abandona:**

1. **Expiración obligatoria.** Default 30 días, renovable. Una bolsa llena de avisos de
   hace dos años deja de leerse, y ahí ya no la recupera nadie.
2. **No es pública.** Sólo socios del club autenticados. Publica teléfonos y mails de
   socios: hacerla pública es un problema de datos personales, no una decisión de
   producto.

Puede ir en cualquier momento después de 1 y 2. Es el candidato natural a postergar si
hay que recortar.

---

## Orden y por qué

```
1. Permisos ──┬─→ 2. Socios y cuotas ──→ 5. Bolsa de trabajo
              │
              └─→ 3. Portal ampliado ──→ 4. Plan de gimnasio
```

- **1 antes que todo**: cada semana que pasa sin esto son más endpoints que después hay
  que migrar.
- **2 antes que 5**: la bolsa necesita saber quién es socio.
- **3 antes que 4**: el plan de gimnasio no sirve si el jugador no entra a la app.
- **5 último**: es el único que no bloquea a ningún otro.

Recomiendo **no arrancar 2 y 3 en paralelo** aunque el grafo lo permita: son los dos
que más UI nueva traen, y partir la atención entre ambos suele terminar con los dos a
medias.

---

## Fuera de alcance de todo el programa

| Qué | Por qué no |
|-----|-----------|
| **Cobro online de cuotas** | PCI, conciliación bancaria, contracargos. Es un proyecto, no una fase |
| **Facturación / AFIP** | Dominio contable con reglas propias; se integra con un sistema existente, no se reimplementa |
| **Periodización automática** | Sigue esperando una temporada de datos, igual que en [[club-operativo]] |
| **App nativa / push** | La web instalable cubre el caso; nativo se evalúa con uso real, no antes |
| **Chat interno** | WhatsApp ya existe y funciona mejor que cualquier chat que hagamos |

---

## Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| **La migración de permisos rompe accesos existentes** | Mapeo 1:1 de cada rol actual a un preset equivalente + test que verifica que cada rol viejo conserva exactamente sus endpoints |
| **111 call sites de permiso a migrar** | Se migran por módulo, no de una. Las dependencias viejas quedan como alias del preset hasta que no queden usos |
| **Socios cadetes son menores** | Datos de tutor y consentimiento de imagen. Es una decisión legal a tomar **con el club** antes de guardar el primer dato, no un default técnico |
| **La bolsa expone contacto de socios** | Consentimiento explícito al publicar, visible sólo para socios autenticados, y el autor puede bajar su aviso cuando quiera |
| **Cuotas mal generadas** | Generación idempotente por período + anulación con motivo y auditoría. Nunca borrado físico |
| **El programa es grande y no sale nada** | Cinco cambios chicos y secuenciados, cada uno útil solo. Si se corta después del 2, el club ya tiene cuotas andando |
| **El club pide cobrar online apenas vea las cuotas** | Está en *Fuera de Alcance* como regla, no como preferencia. Se conversa antes de empezar el 2 |

---

## Lo que hay que decidir antes de escribir la propuesta 1

Tres preguntas que cambian el diseño y no puedo contestar solo:

1. **¿Los socios se cargan a mano o hay un padrón para importar?** Si existe un Excel
   de socios, el cambio 2 arranca con un importador y no con un ABM.
2. **¿Las cuotas son mensuales para todos, o hay anuales y semestrales?** Cambia si
   `período` es `YYYY-MM` o algo más general.
3. **¿El club quiere que el jugador vea su ranking contra sus compañeros?** Motiva a
   unos y expone a otros; prefiero que sea decisión del club y no default mío.

---

## Relacionado

- [[club-operativo]] — alcance por división, que este programa extiende a capacidades
- [[gestion-semanal]] — asistencia y disponibilidad
- [[auth-and-users]] — modelo de roles que el cambio 1 reemplaza
- [[data-model]] — schema actual
