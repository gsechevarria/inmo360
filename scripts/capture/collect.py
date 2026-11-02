"""Recoge capturas del navegador guardadas por la sesión (resultados grandes) y las valida.

Cada captura es texto con cabecera `#INMO360-CAPTURE {json}` y pie `#END <dataset> <i>`.
Se guarda en local-data/captures/<dataset>/chunk_<i>.txt (fuera de Git).
"""
import glob, json, os, sys

SRC = sys.argv[1]
DST = sys.argv[2]
seen = 0
for path in sorted(glob.glob(os.path.join(SRC, "mcp-remote-devices-Claude_Browser__javascript_tool-*.txt"))):
    try:
        raw = json.load(open(path, encoding="utf-8"))
    except Exception:
        continue
    text = raw[0]["text"] if isinstance(raw, list) and raw else ""
    if text.startswith('"'):
        try:
            text, _ = json.JSONDecoder().raw_decode(text)
        except json.JSONDecodeError:
            print(f"!! {os.path.basename(path)}: contenido truncado, se ignora"); continue
    if not text.startswith("#INMO360-CAPTURE "):
        continue
    head, _, rest = text.partition("\n")
    meta = json.loads(head[len("#INMO360-CAPTURE "):])
    name, i = meta["dataset"], meta["chunk"]
    end_marker = f"#END {name} {i}"
    body, sep, _pad = rest.partition(end_marker)
    if not sep:
        print(f"!! {path}: falta marcador final (¿truncado?)"); continue
    os.makedirs(os.path.join(DST, name), exist_ok=True)
    out = os.path.join(DST, name, f"chunk_{i:03d}.txt")
    with open(out, "w", encoding="utf-8") as f:
        f.write(head + "\n" + body.rstrip("\n") + "\n")
    seen += 1
    print(f"ok {name} {i}/{meta['of']} lines={body.count(chr(10))}")
print("total", seen)
