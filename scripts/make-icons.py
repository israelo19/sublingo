"""Generate Sublingo's extension icons (dark rounded tile, yellow + white caption bars) as PNGs."""
import struct, zlib, pathlib

def png(w, h, rows):
    raw = b''.join(b'\x00' + b''.join(struct.pack('BBBB', *p) for p in row) for row in rows)
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

def coverage(fn, x, y, ss=4):
    hits = 0
    for i in range(ss):
        for j in range(ss):
            if fn(x + (i + 0.5) / ss, y + (j + 0.5) / ss):
                hits += 1
    return hits / (ss * ss)

def rounded_rect(x0, y0, x1, y1, r):
    def inside(x, y):
        if x < x0 or x > x1 or y < y0 or y > y1:
            return False
        cx = min(max(x, x0 + r), x1 - r)
        cy = min(max(y, y0 + r), y1 - r)
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
    return inside

def render(size):
    S = float(size)
    tile = rounded_rect(0, 0, S, S, S * 0.22)
    bar1 = rounded_rect(S * 0.18, S * 0.34, S * 0.82, S * 0.47, S * 0.05)
    bar2 = rounded_rect(S * 0.26, S * 0.55, S * 0.74, S * 0.66, S * 0.05)
    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            a = coverage(tile, x, y)
            r, g, b = 27, 27, 34
            c1 = coverage(bar1, x, y)
            c2 = coverage(bar2, x, y)
            if c1 > 0:
                r, g, b = [round(v * (1 - c1) + w * c1) for v, w in zip((r, g, b), (255, 216, 107))]
            if c2 > 0:
                r, g, b = [round(v * (1 - c2) + w * c2) for v, w in zip((r, g, b), (240, 240, 240))]
            row.append((r, g, b, round(255 * a)))
        rows.append(row)
    return png(size, size, rows)

out = pathlib.Path(__file__).resolve().parent.parent / 'src' / 'public' / 'icon'
out.mkdir(parents=True, exist_ok=True)
for s in (16, 32, 48, 128):
    (out / f'{s}.png').write_bytes(render(s))
    print('wrote', out / f'{s}.png')
