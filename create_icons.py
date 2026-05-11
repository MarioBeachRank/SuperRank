"""Gera icon-192.png e icon-512.png para o PWA do SuperRank (sem dependências externas)."""

import os
import struct
import zlib

STATIC = os.path.join(os.path.dirname(__file__), "static")

# Cores da marca
BG   = (26, 60, 74)    # #1A3C4A — teal escuro
ACC  = (232, 98, 42)   # #E8622A — laranja
WHT  = (255, 255, 255) # branco


def make_png(width: int, height: int, pixels: list[tuple[int, int, int]]) -> bytes:
    """Cria um PNG RGB a partir de uma lista linear de tuplas (r,g,b)."""

    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    sig  = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))

    raw = b""
    for row in range(height):
        raw += b"\x00"  # filter None
        for col in range(width):
            r, g, b = pixels[row * width + col]
            raw += bytes([r, g, b])

    idat = chunk(b"IDAT", zlib.compress(raw, 9))
    iend = chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


def draw_icon(size: int) -> list[tuple[int, int, int]]:
    """
    Desenha um ícone quadrado com:
      - fundo #1A3C4A
      - barra laranja na parte inferior (15% da altura)
      - círculo branco central simples
    """
    pixels = [BG] * (size * size)
    cx, cy = size // 2, size // 2
    r = int(size * 0.28)
    stripe_y = int(size * 0.72)

    for y in range(size):
        for x in range(size):
            idx = y * size + x
            # Barra de acento laranja na base
            if y >= stripe_y:
                pixels[idx] = ACC
                continue
            # Círculo branco central
            if (x - cx) ** 2 + (y - cy) ** 2 <= r ** 2:
                pixels[idx] = WHT

    return pixels


for sz, fname in [(192, "icon-192.png"), (512, "icon-512.png")]:
    path = os.path.join(STATIC, fname)
    data = make_png(sz, sz, draw_icon(sz))
    with open(path, "wb") as f:
        f.write(data)
    print(f"  created {fname} ({sz}x{sz}, {len(data)} bytes)")
