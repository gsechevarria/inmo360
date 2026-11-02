"""Cliente HTTP cortés y seguro.

- Solo http/https y puertos estándar; bloquea IP privadas, locales y de enlace (evita SSRF hacia la red interna).
- Respeta robots.txt (si no se puede leer, no se rastrea, salvo APIs declaradas).
- Intervalo mínimo por host y reintentos limitados con espera creciente en 429/5xx.
- No elude autenticaciones, captchas ni bloqueos: un 401/403 se registra como fuente bloqueada.
"""
from __future__ import annotations

import ipaddress
import socket
import threading
import time
import urllib.robotparser
from urllib.parse import urlsplit

import httpx

from .queue import RetryableError, SourceBlocked


class UnsafeURL(ValueError):
    pass


def assert_public_url(url: str, allow_ports: tuple[int, ...] = (80, 443)) -> None:
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise UnsafeURL(f"esquema no permitido: {parts.scheme}")
    if not parts.hostname:
        raise UnsafeURL("URL sin host")
    port = parts.port or (443 if parts.scheme == "https" else 80)
    if port not in allow_ports:
        raise UnsafeURL(f"puerto no permitido: {port}")
    try:
        infos = socket.getaddrinfo(parts.hostname, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as e:
        raise RetryableError(f"DNS: {parts.hostname}: {e}") from e
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified:
            raise UnsafeURL(f"{parts.hostname} resuelve a una dirección no pública ({ip})")


class PoliteClient:
    def __init__(self, user_agent: str, min_interval_s: float = 2.0, timeout_s: float = 30.0,
                 transport: httpx.BaseTransport | None = None, check_public: bool = True, respect_robots: bool = True):
        self.ua = user_agent
        self.min_interval = min_interval_s
        self.check_public = check_public
        self.respect_robots = respect_robots
        self._last: dict[str, float] = {}
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
        self._lock = threading.Lock()
        self.client = httpx.Client(timeout=timeout_s, headers={"User-Agent": user_agent, "Accept-Language": "es-ES,es;q=0.9"},
                                   follow_redirects=False, transport=transport)

    def close(self) -> None:
        self.client.close()

    # -- robots ---------------------------------------------------------------
    def allowed(self, url: str) -> bool:
        if not self.respect_robots:
            return True
        p = urlsplit(url)
        base = f"{p.scheme}://{p.netloc}"
        if base not in self._robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                r = self._raw_get(base + "/robots.txt", max_redirects=2)
                if r.status_code in (401, 403):
                    self._robots[base] = None          # sin acceso → no rastrear
                elif r.status_code >= 400:
                    rp.parse([])                        # sin robots.txt → permitido
                    self._robots[base] = rp
                else:
                    rp.parse(r.text.splitlines())
                    self._robots[base] = rp
            except Exception:
                self._robots[base] = None
        rp = self._robots[base]
        return bool(rp and rp.can_fetch(self.ua, url))

    def crawl_delay(self, url: str) -> float:
        p = urlsplit(url)
        rp = self._robots.get(f"{p.scheme}://{p.netloc}")
        d = rp.crawl_delay(self.ua) if rp else None
        return max(self.min_interval, float(d or 0))

    # -- peticiones -----------------------------------------------------------
    def _wait_turn(self, host: str, interval: float) -> None:
        with self._lock:
            now = time.monotonic()
            wait = self._last.get(host, 0) + interval - now
            self._last[host] = max(now, self._last.get(host, 0) + interval)
        if wait > 0:
            time.sleep(wait)

    def _raw_get(self, url: str, max_redirects: int = 5, **kw) -> httpx.Response:
        for _ in range(max_redirects + 1):
            if self.check_public:
                assert_public_url(url)
            self._wait_turn(urlsplit(url).netloc, self.min_interval)
            r = self.client.get(url, **kw)
            if r.is_redirect and "location" in r.headers:
                url = str(r.next_request.url) if r.next_request else r.headers["location"]
                continue
            return r
        raise RetryableError(f"demasiadas redirecciones: {url}")

    def get(self, url: str, *, robots: bool = True, retries: int = 3, **kw) -> httpx.Response:
        if robots and not self.allowed(url):
            raise SourceBlocked(f"robots.txt no permite {url}")
        delay = 2.0
        for attempt in range(retries + 1):
            try:
                r = self._raw_get(url, **kw)
            except (httpx.TransportError, httpx.TimeoutException) as e:
                if attempt == retries:
                    raise RetryableError(f"{url}: {e}") from e
                time.sleep(delay); delay *= 2
                continue
            if r.status_code in (401, 403):
                raise SourceBlocked(f"{url}: HTTP {r.status_code} (acceso no autorizado; no se elude)")
            if r.status_code == 429 or r.status_code >= 500:
                if attempt == retries:
                    raise RetryableError(f"{url}: HTTP {r.status_code}")
                ra = r.headers.get("retry-after")
                time.sleep(float(ra) if ra and ra.isdigit() else delay); delay *= 2
                continue
            return r
        raise RetryableError(url)
