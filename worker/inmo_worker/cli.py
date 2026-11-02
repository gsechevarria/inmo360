"""Línea de órdenes del trabajador.

  inmo-worker check                 comprueba configuración y conexión (sin mostrar secretos)
  inmo-worker run                   bucle continuo (Ctrl+C para salir)
  inmo-worker once                  procesa como máximo un trabajo y termina
  inmo-worker drain                 procesa trabajos hasta vaciar la cola
"""
from __future__ import annotations

import argparse
import json
import logging
import signal
import sys

from .config import load_settings
from .db import WorkerAPI
from .queue import Runner
from .registry import HANDLERS


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="inmo-worker")
    ap.add_argument("command", choices=["check", "run", "once", "drain"])
    ap.add_argument("--env", help="fichero .env (por defecto ./.env)")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if a.verbose else logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    s = load_settings(a.env)
    s.data_dir.mkdir(parents=True, exist_ok=True)
    api = WorkerAPI(s.database_url)
    runner = Runner(s, api, HANDLERS)
    if a.command == "check":
        print(json.dumps(s.redacted(), ensure_ascii=False, indent=2))
        runner.register()
        print("Conexión y registro correctos. Tipos de trabajo:", ", ".join(sorted(HANDLERS)))
        return 0
    if a.command == "once":
        return 0 if runner.run_once() or True else 1
    if a.command == "drain":
        n = 0
        while runner.run_once():
            n += 1
        print(f"{n} trabajos procesados")
        return 0
    signal.signal(signal.SIGINT, lambda *_: runner.stop())
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, lambda *_: runner.stop())
    runner.run_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
