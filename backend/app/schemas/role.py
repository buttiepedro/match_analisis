import uuid
from typing import Optional

from pydantic import BaseModel


class PermissionCatalogEntry(BaseModel):
    """Una capacidad del catálogo, partida para que la UI la agrupe por dominio."""

    value: str
    domain: str
    action: str


class RoleResponse(BaseModel):
    id: uuid.UUID
    name: str
    is_preset: bool

    #: Lo que el rol concede de verdad: propias **más** heredadas. Es lo que hay
    #: que mirar para responder "¿qué puede hacer alguien con este rol?".
    permissions: list[str]
    #: Las tildadas en este rol. Es lo único editable, y lo que viaja en el PATCH.
    own_permissions: list[str]
    #: Las que llegan por el padre. Se muestran, no se editan: para sacarlas hay
    #: que ir al rol de donde vienen, que es justamente la gracia de heredar.
    inherited_permissions: list[str]

    #: De quién deriva. `parent_name` viene resuelto para que la UI no tenga que
    #: cruzar ids contra la lista.
    parent_role_id: Optional[uuid.UUID] = None
    parent_name: Optional[str] = None

    #: Cuánta gente lo tiene: sin esto, editar un rol es a ciegas.
    user_count: int = 0
    #: Cuántos roles heredan de éste. Avisa el alcance real de un cambio: tocar
    #: Socio con tres hijos toca cuatro roles.
    child_count: int = 0


class RoleCreate(BaseModel):
    name: str
    #: Siempre las **propias**. Las heredadas las calcula el servidor.
    permissions: list[str] = []
    parent_role_id: Optional[uuid.UUID] = None


class RoleUpdate(BaseModel):
    name: Optional[str] = None
    #: `None` deja las capacidades como están; una lista reemplaza las **propias**.
    permissions: Optional[list[str]] = None
    #: `None` no toca el padre. Para sacárselo hay que mandar `parent_role_id`
    #: explícito en `null`, y por eso existe el flag de abajo: en JSON no se
    #: distingue "no lo mando" de "lo mando en null".
    parent_role_id: Optional[uuid.UUID] = None
    #: `true` deja el rol sin padre, ignorando `parent_role_id`.
    clear_parent: bool = False


class UserRolesUpdate(BaseModel):
    role_ids: list[uuid.UUID] = []
