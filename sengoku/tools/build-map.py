#!/usr/bin/env python3
"""
日本の都道府県の地形データ（GeoJSON）から、ゲーム用のマス目地図 src/mapdata.js を作る。

  python3 sengoku/tools/build-map.py path/to/japan.geojson

入力は https://github.com/dataofjapan/land の japan.geojson（都道府県ごとの MultiPolygon）。
北海道・沖縄は 1560 年の舞台ではないので除く。地図は日本列島が横に寝るように約 42 度回転させる。
地形（平地・森・山）は標高データがないので、海からの距離と主な平野の位置から決めている。
"""

import json
import math
import random
import sys

SRC = sys.argv[1] if len(sys.argv) > 1 else 'japan.geojson'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'sengoku/src/mapdata.js'

# ------------------------------------------------------------------ 細かい緯度経度の格子に塗る

LON0, LON1, LAT0, LAT1 = 128.8, 142.6, 30.4, 41.8
FINE = 0.02  # 度
FW = int((LON1 - LON0) / FINE) + 1
FH = int((LAT1 - LAT0) / FINE) + 1
fine = [[0] * FW for _ in range(FH)]  # 0 = 海、それ以外は都道府県 id

with open(SRC, encoding='utf-8') as f:
    geo = json.load(f)


def fill_ring(ring, pid):
    """スキャンラインで多角形の内側を pid で塗る"""
    pts = [(x, y) for x, y in ring]
    n = len(pts)
    ys = [p[1] for p in pts]
    r0 = max(0, int((min(ys) - LAT0) / FINE))
    r1 = min(FH - 1, int((max(ys) - LAT0) / FINE) + 1)
    for r in range(r0, r1 + 1):
        y = LAT0 + r * FINE
        xs = []
        for i in range(n):
            x1, y1 = pts[i]
            x2, y2 = pts[(i + 1) % n]
            if (y1 <= y < y2) or (y2 <= y < y1):
                xs.append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
        xs.sort()
        for j in range(0, len(xs) - 1, 2):
            c0 = max(0, int((xs[j] - LON0) / FINE + 0.5))
            c1 = min(FW - 1, int((xs[j + 1] - LON0) / FINE - 0.5))
            for c in range(c0, c1 + 1):
                fine[r][c] = pid


for feat in geo['features']:
    pid = feat['properties']['id']
    if pid in (1, 47):
        continue  # 北海道・沖縄
    geom = feat['geometry']
    polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
    for poly in polys:
        outer = poly[0]
        if len(outer) < 12:
            continue  # ごく小さな島
        fill_ring(outer, pid)
        for hole in poly[1:]:
            fill_ring(hole, 0)

# 琵琶湖（データでは陸になっているので湖にする）
BIWA = [(135.87, 35.05), (135.93, 35.0), (136.1, 35.05), (136.2, 35.15), (136.25, 35.3), (136.2, 35.45),
        (136.1, 35.5), (136.0, 35.45), (135.92, 35.3), (135.86, 35.15)]
fill_ring(BIWA, 0)


def offshore(lon, lat):
    """舞台に入れない離島"""
    if lat < 30.9:
        return True                       # 屋久島・種子島より南
    if lon > 139.3 and lat < 34.3:
        return True                       # 伊豆諸島
    if lon < 129.6 and lat > 34.0:
        return True                       # 対馬
    if lon < 129.35:
        return True                       # 五島
    if 132.9 < lon < 133.5 and 35.9 < lat < 36.5:
        return True                       # 隠岐
    return False


def sample(lon, lat):
    if offshore(lon, lat):
        return 0
    c = int((lon - LON0) / FINE + 0.5)
    r = int((lat - LAT0) / FINE + 0.5)
    if 0 <= r < FH and 0 <= c < FW:
        return fine[r][c]
    return 0

# ------------------------------------------------------------------ 回転したマス目

ANGLE = math.radians(30)
KX = math.cos(math.radians(36))  # 経度 1 度の実距離（緯度 1 度を 1 として）
CX, CY = 135.7, 36.0


def to_grid_space(lon, lat):
    x = (lon - CX) * KX
    y = lat - CY
    # 反時計回りに回す（列島が横に寝る）
    return (x * math.cos(ANGLE) + y * math.sin(ANGLE), -x * math.sin(ANGLE) + y * math.cos(ANGLE))


def to_lonlat(gx, gy):
    x = gx * math.cos(ANGLE) - gy * math.sin(ANGLE)
    y = gx * math.sin(ANGLE) + gy * math.cos(ANGLE)
    return (x / KX + CX, y + CY)


# 陸の範囲を調べる
xs, ys = [], []
for r in range(0, FH, 3):
    for c in range(0, FW, 3):
        if fine[r][c]:
            gx, gy = to_grid_space(LON0 + c * FINE, LAT0 + r * FINE)
            xs.append(gx)
            ys.append(gy)
COLS = 176
CELL = (max(xs) - min(xs)) / (COLS - 4)
GX0 = min(xs) - 2 * CELL
GY1 = max(ys) + 2 * CELL
ROWS = int((max(ys) - min(ys)) / CELL) + 4

# ------------------------------------------------------------------ 都道府県 → 国

def province_of(pid, lon, lat):
    m = {
        46: 'satsuma', 45: 'hyuga', 43: 'higo', 41: 'hizen', 42: 'hizen', 40: 'chikuzen', 44: 'bungo',
        35: 'nagato', 32: 'izumo', 31: 'hoki', 33: 'bizen',
        38: 'iyo', 39: 'tosa', 37: 'sanuki', 36: 'awa',
        27: 'settsu', 29: 'yamato', 30: 'kii', 18: 'echizen', 24: 'ise',
        21: 'mino', 19: 'kai', 20: 'shinano', 16: 'etchu', 17: 'etchu', 15: 'echigo',
        10: 'kozuke', 11: 'musashi', 13: 'musashi', 14: 'sagami', 12: 'boso', 9: 'shimotsuke', 8: 'hitachi',
        6: 'dewa', 5: 'dewa', 7: 'mutsu', 4: 'mutsu', 3: 'oshu', 2: 'oshu',
    }
    if pid == 34:  # 広島：西が安芸、東が備後
        return 'aki' if lon < 132.95 else 'bingo'
    if pid == 28:  # 兵庫：北が但馬、淡路は阿波（三好領）、南が播磨
        if lat > 35.15:
            return 'tajima'
        if 134.6 < lon < 135.05 and 34.1 < lat < 34.65:
            return 'awa'
        return 'harima'
    if pid == 26:  # 京都：北の丹後は但馬にまとめる
        return 'tajima' if lat > 35.35 else 'yamashiro'
    if pid == 25:  # 滋賀：北近江と南近江
        return 'kitaomi' if lat > 35.25 else 'minamiomi'
    if pid == 23:  # 愛知：尾張と三河
        return 'owari' if lon < 137.18 else 'mikawa'
    if pid == 22:  # 静岡：遠江と駿河（伊豆は駿河に）
        return 'totomi' if lon < 138.2 else 'suruga'
    return m.get(pid)


PROVINCE_ORDER = [
    'satsuma', 'hyuga', 'higo', 'hizen', 'chikuzen', 'bungo',
    'nagato', 'aki', 'bingo', 'izumo', 'hoki', 'bizen', 'harima', 'tajima',
    'iyo', 'tosa', 'sanuki', 'awa',
    'settsu', 'yamashiro', 'yamato', 'kii', 'minamiomi', 'kitaomi', 'echizen', 'ise',
    'mino', 'owari', 'mikawa', 'totomi', 'suruga', 'kai', 'shinano', 'etchu', 'echigo',
    'kozuke', 'musashi', 'sagami', 'boso', 'shimotsuke', 'hitachi',
    'dewa', 'mutsu', 'oshu',
]
PIDX = {p: i for i, p in enumerate(PROVINCE_ORDER)}

prov = [[None] * COLS for _ in range(ROWS)]
lonlat = [[None] * COLS for _ in range(ROWS)]
for r in range(ROWS):
    for c in range(COLS):
        gx = GX0 + (c + 0.5) * CELL
        gy = GY1 - (r + 0.5) * CELL
        lon, lat = to_lonlat(gx, gy)
        lonlat[r][c] = (lon, lat)
        # マスの中心と、その周りの 4 点のうち多数決で陸かどうかを決める
        votes = {}
        for dx, dy in ((0, 0), (0.3, 0.3), (-0.3, 0.3), (0.3, -0.3), (-0.3, -0.3)):
            lo, la = to_lonlat(gx + dx * CELL, gy + dy * CELL)
            pid = sample(lo, la)
            votes[pid] = votes.get(pid, 0) + 1
        pid = max(votes, key=votes.get)
        if pid:
            prov[r][c] = province_of(pid, lon, lat)

# 小さすぎる島（つながった陸が 3 マス未満）は消す
def neighbors(r, c):
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            if dr or dc:
                rr, cc = r + dr, c + dc
                if 0 <= rr < ROWS and 0 <= cc < COLS:
                    yield rr, cc

seen = set()
for r in range(ROWS):
    for c in range(COLS):
        if prov[r][c] and (r, c) not in seen:
            comp = [(r, c)]
            seen.add((r, c))
            i = 0
            while i < len(comp):
                for rr, cc in neighbors(*comp[i]):
                    if prov[rr][cc] and (rr, cc) not in seen:
                        seen.add((rr, cc))
                        comp.append((rr, cc))
                i += 1
            if len(comp) < 3:
                for rr, cc in comp:
                    prov[rr][cc] = None

# 陸のある範囲だけ残す（周りに 2 マスの海）
rows_with = [r for r in range(ROWS) if any(prov[r])]
cols_with = [c for c in range(COLS) if any(prov[r][c] for r in range(ROWS))]
r0, r1 = max(0, rows_with[0] - 2), min(ROWS - 1, rows_with[-1] + 2)
c0, c1 = max(0, cols_with[0] - 2), min(COLS - 1, cols_with[-1] + 2)
prov = [row[c0:c1 + 1] for row in prov[r0:r1 + 1]]
lonlat = [row[c0:c1 + 1] for row in lonlat[r0:r1 + 1]]
ROWS = len(prov)
COLS = len(prov[0])

# ------------------------------------------------------------------ 地形

PLAINS = [  # (経度, 緯度, 半径 km)
    (139.7, 36.0, 70), (136.8, 35.2, 40), (135.5, 34.7, 35), (138.9, 37.7, 35), (130.5, 33.4, 35),
    (140.9, 38.3, 30), (139.9, 38.8, 20), (140.1, 39.7, 20), (140.5, 40.7, 20), (133.9, 34.7, 20),
    (134.0, 34.3, 20), (130.7, 32.8, 25), (131.4, 32.0, 20), (136.1, 35.2, 30), (134.8, 34.8, 20),
    (132.9, 35.4, 15), (138.6, 35.65, 12), (138.0, 36.3, 15), (138.2, 36.6, 12), (137.2, 36.7, 20),
    (136.7, 36.6, 15), (136.2, 36.05, 12), (139.9, 37.5, 12), (140.4, 37.4, 15), (141.1, 39.3, 25),
    (138.4, 34.9, 12), (137.7, 34.75, 15), (137.2, 34.9, 15), (136.5, 34.7, 20), (135.8, 34.6, 12),
    (135.75, 35.0, 12), (135.2, 34.2, 10), (134.5, 34.05, 10), (133.5, 33.55, 10), (132.8, 33.85, 10),
    (132.5, 34.4, 10), (131.5, 34.1, 10), (134.2, 35.5, 10), (133.0, 35.45, 10), (131.6, 33.2, 10),
    (130.3, 33.25, 20), (130.5, 31.6, 15), (140.3, 38.3, 15), (141.1, 39.7, 12), (141.4, 40.5, 12),
    (140.1, 35.5, 30), (139.2, 35.3, 12), (131.0, 32.5, 10), (130.9, 33.9, 10),
]
ALPS = [(137.7, 36.0, 60), (138.6, 35.4, 25), (137.4, 35.5, 30)]  # 山ばかりの場所


def km(lon1, lat1, lon2, lat2):
    return math.hypot((lon1 - lon2) * 111 * KX, (lat1 - lat2) * 111)


rng = random.Random(1560)
terrain = [['~'] * COLS for _ in range(ROWS)]
land = [[prov[r][c] is not None for c in range(COLS)] for r in range(ROWS)]
for r in range(ROWS):
    for c in range(COLS):
        if not land[r][c]:
            continue
        lon, lat = lonlat[r][c]
        coast = any(not land[rr][cc] for rr, cc in neighbors(r, c))
        plain = any(km(lon, lat, x, y) < rad for x, y, rad in PLAINS)
        alps = any(km(lon, lat, x, y) < rad for x, y, rad in ALPS)
        u = rng.random()
        if alps:
            t = 'm' if u < 0.85 else 'f'
        elif plain:
            t = '.' if u < 0.8 else 'f'
        elif coast:
            t = '.' if u < 0.55 else ('f' if u < 0.85 else 'm')
        else:
            t = 'm' if u < 0.5 else ('f' if u < 0.85 else '.')
        terrain[r][c] = t

# ざらつきをならす（周りの多数派に寄せる）
for _ in range(1):
    new = [row[:] for row in terrain]
    for r in range(ROWS):
        for c in range(COLS):
            if not land[r][c]:
                continue
            cnt = {}
            for rr, cc in neighbors(r, c):
                if land[rr][cc]:
                    cnt[terrain[rr][cc]] = cnt.get(terrain[rr][cc], 0) + 1
            if cnt:
                top = max(cnt, key=cnt.get)
                if cnt[top] >= 5:
                    new[r][c] = top
    terrain = new

# ------------------------------------------------------------------ 城の位置

CASTLES = {
    'satsuma': (130.55, 31.6), 'hyuga': (131.35, 32.0), 'higo': (130.7, 32.8), 'hizen': (130.3, 33.25),
    'chikuzen': (130.45, 33.65), 'bungo': (131.6, 33.24), 'nagato': (131.47, 34.18), 'aki': (132.7, 34.6),
    'bingo': (133.4, 34.55), 'izumo': (133.2, 35.35), 'hoki': (134.2, 35.5), 'bizen': (133.93, 34.66),
    'harima': (134.7, 34.85), 'tajima': (134.87, 35.45), 'iyo': (132.78, 33.85), 'tosa': (133.62, 33.6),
    'sanuki': (134.05, 34.33), 'awa': (134.55, 34.1), 'settsu': (135.5, 34.68), 'yamashiro': (135.75, 35.0),
    'yamato': (135.8, 34.65), 'kii': (135.17, 34.23), 'minamiomi': (136.1, 35.15), 'kitaomi': (136.27, 35.45),
    'echizen': (136.3, 36.0), 'ise': (136.5, 34.72), 'mino': (136.78, 35.43), 'owari': (136.85, 35.22),
    'mikawa': (137.17, 34.95), 'totomi': (137.73, 34.71), 'suruga': (138.38, 34.97), 'kai': (138.57, 35.67),
    'shinano': (137.97, 36.23), 'etchu': (137.21, 36.7), 'echigo': (138.23, 37.15), 'kozuke': (139.07, 36.39),
    'musashi': (139.48, 35.92), 'sagami': (139.16, 35.25), 'boso': (140.1, 35.3), 'shimotsuke': (139.88, 36.56),
    'hitachi': (140.53, 36.54), 'dewa': (140.1, 37.92), 'mutsu': (140.87, 38.27), 'oshu': (141.25, 40.4),
}
castles = {}
for pname, (lon, lat) in CASTLES.items():
    best = None
    for r in range(ROWS):
        for c in range(COLS):
            if prov[r][c] != pname:
                continue
            d = km(lon, lat, *lonlat[r][c])
            if best is None or d < best[0]:
                best = (d, c, r)
    if best is None:
        raise SystemExit(f'{pname} にマスがない')
    castles[pname] = [best[1], best[2]]
    terrain[best[2]][best[1]] = '.'

# ------------------------------------------------------------------ 出力

counts = {}
for r in range(ROWS):
    for c in range(COLS):
        if prov[r][c]:
            counts[prov[r][c]] = counts.get(prov[r][c], 0) + 1
missing = [p for p in PROVINCE_ORDER if p not in counts]
if missing:
    raise SystemExit(f'マスのない国: {missing}')

prov_rows = [''.join('~' if prov[r][c] is None else chr(65 + PIDX[prov[r][c]]) for c in range(COLS)) for r in range(ROWS)]
terr_rows = [''.join(terrain[r]) for r in range(ROWS)]

with open(OUT, 'w', encoding='utf-8') as f:
    f.write('/**\n * マス目の日本地図。tools/build-map.py が都道府県の地形データから作る（手で直さない）。\n')
    f.write(' *\n *   terrain: 1 行 1 段。~ 海　. 平地　f 森　m 山\n')
    f.write(' *   province: 同じ並びで、A から順に PROVINCE_ORDER の国。~ は海\n')
    f.write(' *   castles: 国 id → [列, 段]\n */\n\n')
    f.write(f'export const COLS = {COLS};\nexport const ROWS = {ROWS};\n\n')
    f.write('export const PROVINCE_ORDER = [\n  ' + ', '.join(f"'{p}'" for p in PROVINCE_ORDER) + ',\n];\n\n')
    f.write('export const TERRAIN = [\n' + ''.join(f"  '{row}',\n" for row in terr_rows) + '];\n\n')
    f.write('export const PROVINCE = [\n' + ''.join(f"  '{row}',\n" for row in prov_rows) + '];\n\n')
    f.write('export const CASTLES = {\n' + ''.join(f"  {p}: [{c}, {r}],\n" for p, (c, r) in castles.items()) + '};\n')

total = sum(counts.values())
print(f'{COLS} x {ROWS} マス、陸 {total} マス')
for p in PROVINCE_ORDER:
    print(f'  {p:10s} {counts[p]:4d}')
# 地形の内訳
tc = {}
for row in terr_rows:
    for ch in row:
        tc[ch] = tc.get(ch, 0) + 1
print(tc)
