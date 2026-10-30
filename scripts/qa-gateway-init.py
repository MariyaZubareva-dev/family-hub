#!/usr/bin/env python3
"""Create a private QA gateway credential file without storing a plain password."""

import getpass
import hashlib
import json
import os
import secrets
import sys


target = sys.argv[1]
username = "qa"
password = getpass.getpass("Новый отдельный пароль QA: ")
confirmation = getpass.getpass("Повторите пароль: ")
if password != confirmation:
    raise SystemExit("Пароли не совпадают.")
if len(password) < 16:
    raise SystemExit("Используйте пароль не короче 16 символов.")

salt = secrets.token_bytes(16)
password_hash = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32)
config = {
    "username": username,
    "password_salt": salt.hex(),
    "password_hash": password_hash.hex(),
    "session_secret": secrets.token_urlsafe(48),
}
temporary = target + ".tmp"
with open(temporary, "w", encoding="utf-8") as config_file:
    json.dump(config, config_file)
    config_file.write("\n")
os.chmod(temporary, 0o644)
os.replace(temporary, target)
print("Готово: пароль записан только в виде scrypt-хеша; логин: qa.")
