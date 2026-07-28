"""
Los dos chequeos que mira el despliegue.

Importa que sean **distintos**: si `/health` tocara la base, un rato de base
lenta haría que el orquestador reiniciara en loop un backend que no tiene nada
malo — y reiniciarlo no arregla una base caída, sólo agrega caídas.
"""


async def test_health_is_alive_without_touching_the_database(client):
    res = await client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


async def test_ready_confirms_the_database_answers(client):
    res = await client.get("/health/ready")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "database": "ok"}


async def test_neither_check_requires_a_session(client):
    """El healthcheck de compose corre sin credenciales."""
    for path in ("/health", "/health/ready"):
        assert (await client.get(path)).status_code == 200
