---
title: Bolsa de trabajo
status: active
created: 2026-07-28
---

# Bolsa de trabajo

> Refleja lo implementado en `api/v1/job_board.py`, `models/job_board.py`, la migración
> `0019` y `pages/JobBoard.tsx`.

Un socio publica que ofrece o que busca trabajo, y el resto de los socios lo ve. Es el
único módulo del programa que **no tiene nada que ver con rugby**: es un beneficio de
ser socio, como la pileta.

## Las dos decisiones que definen si se usa o se abandona

### 1. Expiración obligatoria

Todo aviso aprobado vence a los **30 días**, renovable por el autor sin volver a pedir
permiso. Una bolsa llena de avisos de hace dos años deja de leerse, y de ahí no la
recupera nadie.

El vencimiento se calcula **al leer**, no con una tarea programada:

```python
def _is_expired(post: JobPost) -> bool:
    return bool(post.expires_on and post.expires_on < date.today())
```

Así `vencido` siempre es exacto y el módulo no necesita un scheduler — una pieza de
infraestructura entera que habría que operar para algo que se resuelve con una
comparación de fechas.

### 2. No es pública

Publica el teléfono de un socio. Verla exige sesión y capacidad `bolsa.ver`; un usuario
del club sin esa capacidad recibe 403, y otro club no la ve nunca. Hacerla pública no
es una decisión de producto, es un problema de datos personales.

## Circulación del contacto

El contacto se muestra **sólo en un aviso vigente**, o al propio autor:

```python
visible = post.status == JobStatus.publicado and not _is_expired(post)
contact = post.contact if (visible or own) else None
```

En un aviso vencido o rechazado, el teléfono no aporta nada y sigue circulando. La
contracara es que **el autor puede bajar su aviso cuando quiera**, sin pedirle permiso a
nadie: es el arrepentimiento de haber publicado un dato propio.

## Moderación

```
publica → pendiente → [bolsa.moderar] → publicado (+ expires_on)
                                     └→ rechazado (+ motivo)
```

- **Rechazar exige motivo**, y el motivo lo ve **sólo el autor**. Sin motivo el autor no
  sabe qué corregir y vuelve a mandar lo mismo.
- **Editar devuelve el aviso a `pendiente`.** Si editar dejara el aviso publicado,
  moderar no serviría de nada: se aprueba "busco changas" y se edita a cualquier cosa.

## Modelo

```
job_posts  club_id, author_id, kind (ofrece|busca), title, description,
           contact, category, status (pendiente|publicado|rechazado),
           moderation_note, moderated_by, published_at, expires_on
           INDEX (club_id, status)
```

`vencido` **no** es un estado guardado: es `publicado` con `expires_on` pasado. Un
estado que hay que ir a escribir todos los días es un estado que algún día queda mal.

## Pantalla

`/bolsa`, tres vistas según capacidad: **Avisos** (todos), **Mis avisos** (los propios en
cualquier estado, para ver el rechazo y su motivo) y **A revisar** (cola de moderación).

Al componer, el aviso dice de frente qué se va a publicar: *"Tu contacto lo van a ver los
demás socios mientras el aviso esté publicado. Podés bajarlo cuando quieras."* Es el
consentimiento explícito que pedía el riesgo del roadmap, en el momento en que importa.

## Permisos

| Capacidad | Quién |
|-----------|-------|
| `bolsa.ver` | preset **Socio** |
| `bolsa.publicar` | preset **Socio** |
| `bolsa.moderar` | **Administrador** |

El preset **Socio** queda entonces con su estado de cuota más la bolsa — y nada sobre
los datos de los demás socios. El test `test_the_socio_preset_never_grants_access_to_other_members`
encodea esa regla en vez del listado literal: el preset puede crecer con beneficios,
nunca con acceso al padrón ajeno.

## Relacionado

- [[socios]] — quién es socio, y de dónde sale
- [[permisos]] — capacidades y presets
- [[add-plataforma-club-roadmap]] — el programa
