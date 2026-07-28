---
title: Socios
status: active
created: 2026-07-27
---

# Socios

> Refleja lo implementado en `core/members.py`, `api/v1/members.py`, `api/v1/auth.py`
> y la migración `0017`.

## El principio

La app **espeja** el estado de cuota que informa el sistema contable del club. No lo
calcula, no registra pagos y no lleva contabilidad. Dos fuentes de verdad sobre plata
terminan mal siempre.

## Modelo

```
members         club_id, user_id (NOT NULL), full_name, category, member_number,
                joined_on, is_active, dues_up_to_date, dues_synced_at
member_imports  log de cada sincronización
users           + document_id (DNI), + must_change_password, email pasa a NULLABLE
```

`Member.user_id` es NOT NULL, al revés que `Player.user_id`: cada socio del padrón
recibe cuenta, porque el punto del módulo es que entre a ver su estado.

**`dues_synced_at` es la columna más importante de la tabla.** Mostrar "estás al día"
sin decir a qué fecha corresponde el dato es desinformar.

## Sincronización

Excel y el futuro cliente de API llaman a la **misma** `sync_members`. Cambiar de
fuente es escribir un parser, no una reescritura.

Reglas:

1. Match por **DNI** dentro del club.
2. Existe → se actualiza. **La contraseña no se toca**: re-importar no puede sacarle
   el acceso a nadie.
3. No existe → se crea socio + cuenta, con `must_change_password`.
4. En la base y no en el archivo → `is_active = false`. **Nunca se borra**: una baja
   se revierte, un borrado no.
5. `dues_synced_at` se actualiza en **todas** las filas, cambie o no el estado.
6. Idempotente: el mismo archivo dos veces deja el mismo estado.

### Protecciones del import semanal

- **`dry_run`** devuelve qué haría sin escribir, con los **nombres** de quiénes se
  darían de baja.
- **Freno al 20%**: un import que desactive más de eso se rechaza sin `force`. El
  error probable es el archivo equivocado, y es el más caro.
- **Log de cada import**: sin él, con 200 bajas nadie sabe qué archivo las hizo.
- Una fila mala no descarta el import: se reporta con su número de fila.

### Parser

Encabezados tolerantes a acentos y **puntuación**: un padrón real trae `N° Socio`, y
el `°` no es un acento —sobrevive a NFD—, así que sin sacarlo la columna no matchea.

`Al día` acepta lo que escriben los sistemas contables: `SI`/`NO`, `1`/`0`,
`AL DIA`/`DEUDOR`, `TRUE`/`FALSE`.

## Ingreso

`POST /auth/login` acepta `email` **o** `document_id`. El staff sigue entrando por
email. El frontend distingue por la forma del texto, para no preguntarle al usuario
qué tipo de dato va a escribir.

El DNI es único **por club**: la misma persona puede ser socia de dos. Si resuelve a
más de uno, el login devuelve `409` con la lista y el cliente reintenta con
`club_slug`.

### Contraseña por defecto

La elige quien importa, mínimo 8 caracteres, y **nunca es el DNI**: serían usuario y
contraseña el mismo dato, y el DNI está en el padrón y en cualquier planilla.

`must_change_password` bloquea toda la app salvo la pantalla de cambio. Eso acota la
ventana entre el import y el primer ingreso — ventana en la que, además, lo único
visible es el propio estado de cuota.

## Lo que ve el socio

`GET /me/membership`: si está al día **y la fecha del dato**, con un "actualizado hace
N días" al lado. Si debe, la pantalla aclara que un pago posterior a esa fecha
todavía no llegó a la app.

## Permisos

| Capacidad | Quién |
|-----------|-------|
| `socios.ver_propia` | preset **Socio** |
| `socios.ver_todas` · `socios.importar` | preset **Tesorero** |

El menú se filtra por capacidad, así que un Tesorero ve Socios y un Entrenador no,
aunque compartan el `role` del enum viejo.

## Relacionado

- [[add-socios-padron]] — la propuesta
- [[permisos]] — capacidades y presets
- [[add-plataforma-club-roadmap]] — el programa
