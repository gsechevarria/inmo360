# Trabajador local de Inmo360

Proceso Python que se ejecuta en el PC del propietario. Recoge trabajos de la cola de Supabase (`ingest.jobs`), ejecuta los conectores y entrega los datos mediante funciones `ingest.worker_*` (el rol `inmo_worker` no tiene acceso directo a tablas). Las fotos, si se activan, se quedan en el disco local.

- Instalación y uso en Windows: [`../docs/GUIA_WINDOWS.md`](../docs/GUIA_WINDOWS.md)
- Tipos de trabajo y formato de ficheros: [`../docs/IMPORTACIONES.md`](../docs/IMPORTACIONES.md)
- Reglas y contrato para conectores: [`../docs/CONECTORES.md`](../docs/CONECTORES.md)

```bash
pip install -e ".[dev]"
cp .env.example .env        # credencial del rol inmo_worker y carpeta de datos
inmo-worker check | run | once | drain
python -m pytest -q         # las pruebas marcadas «db» requieren la base aislada local
```

| Módulo | Función |
|---|---|
| `queue.py` | Reserva, latido y renovación en hilo aparte, cancelación cooperativa, reintentos con espera, puntos de control |
| `db.py` | Cliente de las funciones `ingest.worker_*` (sin acceso a tablas) |
| `http.py` | Cliente HTTP cortés: robots.txt, ritmo por host, reintentos 429/5xx, protección SSRF |
| `normalize.py` | Contratos de anuncio y observación (validados contra `packages/contracts/generated`) |
| `storage.py` | Almacén local por hash y migración reanudable a Supabase Storage |
| `connectors/` | `geo`, `ine_tempus`, `browser_capture`, `listings` (fichero, JSON-LD, Kyero, Idealista), `media` |
