# -*- coding: utf-8 -*-
"""Every t('...') key used in src/ must exist in en.json; en and el must have the same leaves.
Template keys (t(`slots.${s}`)) are checked by prefix. Exit 1 on any miss."""
import json
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1])
en = json.loads((root / "src/i18n/en.json").read_text(encoding="utf-8"))
el = json.loads((root / "src/i18n/el.json").read_text(encoding="utf-8"))


def leaves(d, pre=""):
    for k, v in d.items():
        if isinstance(v, dict):
            yield from leaves(v, pre + k + ".")
        else:
            yield pre + k


E, L = set(leaves(en)), set(leaves(el))
base = {re.sub(r"_(one|other)$", "", k) for k in E}
missing = []
used = set()
for path in root.glob("src/**/*.ts*"):
    text = path.read_text(encoding="utf-8")
    for m in re.finditer(r"\bt\(\s*'([^']+)'", text):
        used.add(m.group(1))
        if m.group(1) not in E and m.group(1) not in base:
            missing.append((str(path.relative_to(root)), m.group(1)))
    for m in re.finditer(r"\bt\(\s*`([^`]+)`", text):
        key = m.group(1)
        prefix = key.split("${")[0].rstrip(".")
        used.add(key)
        if not any(k.startswith(prefix + ".") for k in E):
            missing.append((str(path.relative_to(root)), key))
print("en leaves", len(E), "| el leaves", len(L), "| en-el diff", sorted(E ^ L))
print("static keys used", len(used))
for m in missing:
    print("MISSING", m)
unused = sorted(k for k in E if k not in used and re.sub(r"_(one|other)$", "", k) not in used and not any(k.startswith(u.split("${")[0].rstrip(".") + ".") for u in used if "${" in u))
print("unused leaves", len(unused), unused[:40])
sys.exit(1 if missing or E != L else 0)
