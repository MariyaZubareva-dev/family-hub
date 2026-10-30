#!/usr/bin/env python3
"""Small form-authenticated reverse proxy for the temporary QA stand."""

from __future__ import annotations

import base64
import hashlib
import hmac
import html
import http.client
import json
import os
import secrets
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit


CONFIG_PATH = os.environ.get("QA_GATEWAY_CONFIG", "/run/qa-gateway/config.json")
SESSION_SECONDS = 8 * 60 * 60
MAX_BODY = 16 * 1024 * 1024
FAILED_LOGINS: deque[float] = deque()
FAILED_LOGINS_LOCK = threading.Lock()
HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}

with open(CONFIG_PATH, "r", encoding="utf-8") as config_file:
    CONFIG = json.load(config_file)

USERNAME = CONFIG["username"]
PASSWORD_SALT = bytes.fromhex(CONFIG["password_salt"])
PASSWORD_HASH = bytes.fromhex(CONFIG["password_hash"])
SESSION_SECRET = base64.urlsafe_b64decode(CONFIG["session_secret"] + "==")


def b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def signature(purpose: str, value: str) -> str:
    payload = f"{purpose}:{value}".encode("utf-8")
    return b64(hmac.new(SESSION_SECRET, payload, hashlib.sha256).digest())


def signed_token(purpose: str, max_age: int) -> str:
    payload = f"{int(time.time()) + max_age}.{secrets.token_urlsafe(18)}"
    return f"{payload}.{signature(purpose, payload)}"


def valid_token(purpose: str, token: str, max_age: int) -> bool:
    try:
        expires, nonce, supplied_signature = token.split(".", 2)
        payload = f"{expires}.{nonce}"
        expires_at = int(expires)
    except (ValueError, TypeError):
        return False
    now = int(time.time())
    return (
        now <= expires_at <= now + max_age + 60
        and hmac.compare_digest(supplied_signature, signature(purpose, payload))
    )


class Gateway(BaseHTTPRequestHandler):
    server_version = "FamilyHubQAGateway"
    sys_version = ""

    def do_GET(self) -> None:
        self.dispatch()

    def do_HEAD(self) -> None:
        self.dispatch()

    def do_POST(self) -> None:
        if urlsplit(self.path).path == "/__qa_login":
            self.login()
            return
        self.dispatch()

    def do_PUT(self) -> None:
        self.dispatch()

    def do_PATCH(self) -> None:
        self.dispatch()

    def do_DELETE(self) -> None:
        self.dispatch()

    def do_OPTIONS(self) -> None:
        self.dispatch()

    def dispatch(self) -> None:
        path = urlsplit(self.path).path
        if path == "/_qa_health":
            self.respond(200, b"ok\n", "text/plain; charset=utf-8")
            return
        if not self.authenticated():
            if path.startswith("/api/"):
                self.respond(401, b'{"message":"Unauthenticated"}\n', "application/json")
            else:
                self.login_page()
            return
        self.proxy()

    def login(self) -> None:
        if self.login_limited():
            self.login_page(error="Слишком много попыток. Повторите позже.")
            return
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        length = self.content_length()
        if content_type != "application/x-www-form-urlencoded" or length is None or length > 16_384:
            self.respond(400, b"Bad request\n", "text/plain; charset=utf-8")
            return

        try:
            form = parse_qs(self.rfile.read(length).decode("utf-8"), keep_blank_values=True)
        except (UnicodeDecodeError, ValueError):
            self.respond(400, b"Bad request\n", "text/plain; charset=utf-8")
            return

        username = form.get("username", [""])[0]
        password = form.get("password", [""])[0]
        csrf = form.get("csrf", [""])[0]
        origin = urlsplit(self.headers.get("Origin", ""))
        expected_host = self.headers.get("X-Forwarded-Host", self.headers.get("Host", "")).split(",", 1)[0].strip()
        valid_origin = origin.scheme == "https" and origin.netloc.casefold() == expected_host.casefold()
        referer = urlsplit(self.headers.get("Referer", ""))
        valid_referer = (
            referer.scheme == "https"
            and referer.netloc.casefold() == expected_host.casefold()
            and referer.path.startswith("/")
            and not referer.path.startswith("//")
        )
        valid_csrf = valid_token("login", csrf, 600)

        try:
            candidate_hash = hashlib.scrypt(
                password.encode("utf-8"), salt=PASSWORD_SALT, n=2**14, r=8, p=1, dklen=len(PASSWORD_HASH)
            )
        except (ValueError, MemoryError):
            self.respond(503, b"Authentication temporarily unavailable\n", "text/plain; charset=utf-8")
            return

        valid_user = hmac.compare_digest(username.encode("utf-8"), USERNAME.encode("utf-8"))
        valid_password = hmac.compare_digest(candidate_hash, PASSWORD_HASH)
        if not (valid_origin and valid_referer and valid_csrf and valid_user and valid_password):
            self.record_failed_login()
            self.login_page(error="Неверный логин или пароль.")
            return
        with FAILED_LOGINS_LOCK:
            FAILED_LOGINS.clear()

        token = signed_token("session", SESSION_SECONDS)
        cookie_path = "/qa/" if referer.path.startswith("/qa/") else "/"
        next_path = referer.path
        if referer.query:
            next_path += f"?{referer.query}"
        cookie = (
            f"fhqa_session={token}; Path={cookie_path}; Max-Age={SESSION_SECONDS}; "
            "HttpOnly; Secure; SameSite=Lax"
        )
        if cookie_path == "/qa/":
            next_path = "/qa/"
        else:
            next_path = "/"
        self.send_response(303)
        self.security_headers()
        self.send_header("Set-Cookie", cookie)
        self.send_header("Location", next_path)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def authenticated(self) -> bool:
        cookie_header = self.headers.get("Cookie", "")
        for item in cookie_header.split(";"):
            name, separator, value = item.strip().partition("=")
            if separator and name == "fhqa_session":
                return valid_token("session", value, SESSION_SECONDS)
        return False

    def login_page(self, error: str = "", status: int = 200) -> None:
        csrf = signed_token("login", 600)
        safe_error = f'<p class="error" role="alert">{html.escape(error)}</p>' if error else ""
        page = f"""<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Вход — Family Hub QA</title><meta name="robots" content="noindex,nofollow">
<style>body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f5f2;color:#263e3b;font:16px system-ui,sans-serif}}main{{box-sizing:border-box;width:min(100% - 32px,400px);padding:32px;background:#fff;border:1px solid #dce5df;border-radius:20px;box-shadow:0 10px 40px #263e3b12}}h1{{margin:0 0 8px;font-size:24px}}p{{color:#71817c}}label{{display:block;margin:18px 0 6px;font-weight:600}}input{{box-sizing:border-box;width:100%;padding:12px;border:1px solid #bccbc4;border-radius:10px;font:inherit}}button{{width:100%;margin-top:24px;padding:13px;border:0;border-radius:10px;background:#117b73;color:#fff;font:600 16px system-ui,sans-serif;cursor:pointer}}.error{{color:#a32323}}</style></head>
<body><main><h1>Family Hub</h1><p>Тестовый стенд. Войдите, чтобы продолжить.</p>{safe_error}
<form method="post" action="__qa_login">
<label for="username">Логин</label><input id="username" name="username" type="text" autocomplete="username" required autofocus>
<label for="password">Пароль</label><input id="password" name="password" type="password" autocomplete="current-password" required>
<input type="hidden" name="csrf" value="{html.escape(csrf, quote=True)}">
<button type="submit">Войти</button></form></main></body></html>""".encode("utf-8")
        self.respond(status, page, "text/html; charset=utf-8")

    def proxy(self) -> None:
        length = self.content_length()
        if length is None:
            length = 0
        if length > MAX_BODY:
            self.respond(413, b"Request too large\n", "text/plain; charset=utf-8")
            return
        body = self.rfile.read(length) if length else None
        headers: dict[str, str] = {}
        for name, value in self.headers.items():
            lower = name.lower()
            if lower in HOP_HEADERS or lower in {"host", "authorization", "content-length"}:
                continue
            if lower == "cookie":
                kept = [part.strip() for part in value.split(";") if part.strip().split("=", 1)[0] != "fhqa_session"]
                if kept:
                    headers[name] = "; ".join(kept)
                continue
            headers[name] = value
        headers["Host"] = self.headers.get("Host", "localhost")
        headers["X-Forwarded-For"] = self.client_address[0]
        headers["X-Forwarded-Proto"] = self.headers.get("X-Forwarded-Proto", "https")
        if body is not None:
            headers["Content-Length"] = str(len(body))

        upstream = http.client.HTTPConnection("frontend", 80, timeout=120)
        try:
            upstream.request(self.command, self.path, body=body, headers=headers)
            response = upstream.getresponse()
            response_body = response.read()
            self.send_response(response.status, response.reason)
            for name, value in response.getheaders():
                if name.lower() not in HOP_HEADERS and name.lower() != "content-length":
                    self.send_header(name, value)
            self.security_headers()
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(response_body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(response_body)
        except (OSError, http.client.HTTPException):
            self.respond(502, b"QA frontend is unavailable\n", "text/plain; charset=utf-8")
        finally:
            upstream.close()

    def content_length(self) -> int | None:
        value = self.headers.get("Content-Length")
        if value is None:
            return 0
        try:
            length = int(value)
        except ValueError:
            return None
        return length if length >= 0 else None

    @staticmethod
    def login_limited() -> bool:
        now = time.time()
        with FAILED_LOGINS_LOCK:
            while FAILED_LOGINS and now - FAILED_LOGINS[0] > 900:
                FAILED_LOGINS.popleft()
            return len(FAILED_LOGINS) >= 5

    @staticmethod
    def record_failed_login() -> None:
        with FAILED_LOGINS_LOCK:
            FAILED_LOGINS.append(time.time())

    def security_headers(self) -> None:
        self.send_header("X-Robots-Tag", "noindex, nofollow")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")

    def respond(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.security_headers()
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        # Request bodies, cookies, and authorization values are never logged.
        super().log_message(format, *args)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", 8080), Gateway)
    server.daemon_threads = True
    server.serve_forever()
