---
title: Endpoints de Autenticación
type: feature
status: done
archived: 2026-05-30
spec: auth-and-users
created: 2026-05-29
---

# Endpoints de Autenticación

## Objetivo

Implementar el sistema de autenticación JWT completo: login, renovación de token, logout e info del usuario actual. Es el prerequisito para cualquier endpoint protegido.

## Alcance

### Backend
- [x] `POST /auth/login` — email + contraseña → access_token + refresh_token + user
- [x] `POST /auth/refresh` — refresh_token → nuevo access_token
- [x] `POST /auth/logout` — revoca el refresh_token en DB
- [x] `GET /auth/me` — retorna datos del usuario autenticado
- [x] `app/schemas/user.py` — UserResponse (Pydantic)
- [x] `app/schemas/auth.py` — LoginRequest, TokenResponse, RefreshRequest, etc.
- [x] `app/core/deps.py` — `get_current_user`, `require_superadmin`, `require_club_admin`, `require_timer_control`

### Frontend
- [ ] Conectar pantalla de login al `POST /auth/login` real
- [ ] Guardar access_token + refresh_token en store
- [ ] Implementar refresh automático cuando el access_token expira

## Flujo de Tokens

```
Login → access_token (60min) + refresh_token (7d)
                    │
          access_token expira
                    │
         POST /auth/refresh → nuevo access_token
                    │
         Logout → refresh_token revocado en DB
```

## Reglas de Negocio

- El refresh_token se almacena hasheado (SHA-256) en la tabla `refresh_tokens`
- Al hacer logout se marca como `revoked = true` (no se elimina)
- Un usuario inactivo no puede loguearse ni renovar token
- El payload del JWT incluye: `sub` (user_id), `role`, `club_id`

## Dependencias

- `project-scaffold` completado

## Próxima Tarea

`club-management` — CRUD de clubes y usuarios
