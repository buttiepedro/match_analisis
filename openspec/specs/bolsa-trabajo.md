---
title: Bolsa de trabajo
status: active
created: 2026-07-28
---

# Bolsa de trabajo

> Refleja lo implementado en `api/v1/job_board.py`, `core/storage.py`,
> `models/job_board.py`, las migraciones `0019` y `0022`, y en el frontend
> `pages/JobBoard.tsx`, `pages/JobPost.tsx`, `components/Composer.tsx` y
> `lib/richText.tsx`.

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

## Tarjeta y página

Un aviso vive en dos lados: la **tarjeta** del listado y su **página**.

Antes el aviso entero estaba en la lista, y eso fuerza a elegir entre dos cosas
malas: recortar el texto y perder lo que el aviso dice, o mostrarlo completo y
que el tercer aviso ya quede fuera de la pantalla. Con las dos, la lista sirve
para elegir y la página para leer.

El resumen de la tarjeta lo calcula el **servidor** (`excerpt`), no el cliente:
así la tarjeta y la página no pueden recortar distinto, y el listado no manda el
cuerpo entero de treinta avisos para mostrar tres líneas de cada uno. Las
iniciales del autor también vienen resueltas, por el mismo motivo.

`GET /job-posts/{id}` aplica la misma regla que el listado: un aviso que no está
vigente lo ven **sólo su autor y quien modera**. Si no, el listado escondería los
vencidos y cualquiera con el link los seguiría leyendo, con el teléfono adentro.

## Texto con formato, sin HTML

El aviso admite subtítulos, negrita, cursiva, listas, emojis y links
automáticos. Se guarda como **texto plano con marcas** y se renderiza generando
**elementos de React**, nunca HTML.

Es la decisión que define el módulo. Con `dangerouslySetInnerHTML` habría que
sanear lo que escribe un socio, y sanear HTML a mano es una carrera que se
pierde. Acá el texto del usuario sólo puede terminar como contenido de un nodo de
texto: no hay forma de que se vuelva markup porque nunca se interpreta como
markup. Los links se filtran por protocolo — `javascript:` en un `href` es un XSS
con otra ropa — y salen con `rel="noopener noreferrer"`.

El editor trabaja sobre un `textarea`, no sobre un `contenteditable`. Un
contenteditable trae su propio HTML —el que pega alguien desde Word, con sus
`<span style>` adentro— y ahí sí hay que sanear.

**No hay selector de tipografías ni de tamaños**, a propósito. Treinta avisos con
treinta tipografías se ven como un tablón de corcho; lo que da la sensación de
portal es que todos compartan la misma jerarquía. Es también lo que hace LinkedIn.

## Imagen y archivos

Portada (`cover_image_url`) más hasta **5 adjuntos** por aviso: el CV, un
presupuesto, fotos de trabajos hechos. El tope no es técnico — un aviso con
quince archivos ya no se lee, y la moderación tiene que poder revisarlos.

Todo pasa por `core/storage`, que concentra las reglas:

- **Lista blanca de tipos.** Una lista de prohibidos siempre se queda corta.
- El `content_type` que se guarda es **el de la lista**, no el que mandó el
  cliente: si no, alguien sube un `.html` diciendo que es un PDF y el bucket lo
  sirve como página.
- **Los documentos salen con `Content-Disposition: attachment`.** Un archivo
  subido por un socio que el browser *renderiza* en el dominio del bucket es un
  XSS almacenado, no una comodidad. Las imágenes sí se muestran: su tipo ya está
  en la lista.
- La clave en S3 es **aleatoria**; el nombre original se guarda sólo para
  mostrarlo.
- Imágenes hasta 5 MB, documentos hasta 10 MB.

**Subir es del autor, no del moderador.** El moderador aprueba o rechaza lo que
el otro armó; no lo edita por él.

Bajar el aviso **borra también los archivos**: es arrepentirse de haber publicado
algo, y dejar la imagen y el CV accesibles por URL sería no cumplir con eso.
Cambiar la portada borra la anterior, o cada cambio deja basura pagada en el
bucket.

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
