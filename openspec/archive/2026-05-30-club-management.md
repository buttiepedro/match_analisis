---
title: Gestión de Clubes y Usuarios
type: feature
status: done
archived: 2026-05-30
spec: auth-and-users
created: 2026-05-30
---

# Gestión de Clubes y Usuarios

## Objetivo

CRUD de clubes (superadmin) y usuarios del club (club_admin). Permite al superadmin crear clubes con su admin inicial, y al club_admin gestionar los analistas y directores de partido de su club.

## Alcance

### Backend
- [x] `POST /clubs` — crear club + club_admin inicial en una transacción
- [x] `GET /clubs` — listar todos los clubes (superadmin)
- [x] `GET /clubs/{club_id}` — detalle del club (superadmin o admin del propio club)
- [x] `POST /clubs/{club_id}/users` — crear analyst o match_director
- [x] `GET /clubs/{club_id}/users` — listar usuarios del club
- [x] `PATCH /clubs/{club_id}/users/{user_id}` — editar nombre, rol, estado
- [x] `DELETE /clubs/{club_id}/users/{user_id}` — soft delete (is_active = false)
- [x] `schemas/club.py` — ClubCreate, ClubResponse
- [x] `schemas/user.py` — UserCreate, UserUpdate

### Frontend
- [ ] Pantalla superadmin: lista de clubes + form de creación
- [ ] Pantalla club_admin: lista de usuarios + form de creación/edición

## Reglas de Negocio

1. Al crear un club, el superadmin define el club_admin inicial (email + contraseña)
2. El slug se genera automáticamente desde el nombre del club
3. club_admin solo puede crear roles `match_director` o `analyst` (no otro club_admin)
4. club_admin solo puede ver y gestionar usuarios de su propio club
5. Soft delete: is_active = false, el usuario no puede loguearse

## Dependencias

- `auth-endpoints` completado

## Próxima Tarea

`tournament-setup` — divisiones y torneos
