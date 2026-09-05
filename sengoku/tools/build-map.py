#!/usr/bin/env python3
"""
日本の都道府県の地形データ（GeoJSON）から、ゲーム用のマス目地図 src/mapdata.js を作る。

  python3 sengoku/tools/build-map.py path/to/japan.geojson [sengoku/src/mapdata.js]

入力は https://github.com/dataofjapan/land の japan.geojson（都道府県ごとの MultiPolygon）。
北海道・沖縄は 1560 年の舞台ではないので除く。地図は日本列島が横に寝るように約 30 度回転させる。

手順
  1. 都道府県ごとの多角形を細かい緯度経度の格子に塗る
  2. 回転したマス目の中心が、どの都道府県にあるかを調べ、緯度経度の目安で旧国（国）に分ける
  3. 各マスを、同じ国の中でいちばん近い城の領地にする（castles.py の一覧）
  4. 領地が接している城どうしを隣接とし、海路（castles.py）を足す
  5. 地形（平地・森・山）は標高データがないので、海からの距離と主な平野の位置から決める
"""

import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from castles import CASTLES, SEA_LINKS  # noqa: E402

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
    return (x * math.cos(ANGLE) + y * math.sin(ANGLE), -x * math.sin(ANGLE) + y * math.cos(ANGLE))


def to_lonlat(gx, gy):
    x = gx * math.cos(ANGLE) - gy * math.sin(ANGLE)
    y = gx * math.sin(ANGLE) + gy * math.cos(ANGLE)
    return (x / KX + CX, y + CY)


xs, ys = [], []
for r in range(0, FH, 3):
    for c in range(0, FW, 3):
        if fine[r][c] and not offshore(LON0 + c * FINE, LAT0 + r * FINE):
            gx, gy = to_grid_space(LON0 + c * FINE, LAT0 + r * FINE)
            xs.append(gx)
            ys.append(gy)
COLS = 196
CELL = (max(xs) - min(xs)) / (COLS - 4)
GX0 = min(xs) - 2 * CELL
GY1 = max(ys) + 2 * CELL
ROWS = int((max(ys) - min(ys)) / CELL) + 4

# ------------------------------------------------------------------ 都道府県 → 国


def kuni_of(pid, lon, lat):
    simple = {
        46: '薩摩', 43: '肥後', 41: '肥前', 42: '肥前', 44: '豊後',
        32: '出雲', 31: '伯耆', 38: '伊予', 39: '土佐', 37: '讃岐', 36: '阿波',
        29: '大和', 30: '紀伊', 21: '美濃', 19: '甲斐', 20: '信濃', 16: '越中', 15: '越後',
        10: '上野', 11: '武蔵', 13: '武蔵', 14: '相模', 9: '下野', 8: '常陸',
    }
    if pid in simple:
        k = simple[pid]
        if pid == 46 and lon > 130.75:
            return '大隅'
        if pid == 32 and lon < 132.65:
            return '石見'
        if pid == 31 and lon > 133.75:
            return '因幡'
        if pid == 21 and lat > 35.9:
            return '飛騨'
        if pid == 15 and lon < 138.7 and lat > 37.7:
            return '佐渡'
        return k
    if pid == 45:
        return '日向'
    if pid == 40:  # 福岡：筑前・筑後・豊前
        if lon > 130.85 and lat > 33.55:
            return '豊前'
        return '筑後' if lat < 33.35 else '筑前'
    if pid == 35:  # 山口：周防・長門
        return '長門' if lon < 131.35 else '周防'
    if pid == 34:  # 広島：安芸・備後
        return '安芸' if lon < 132.95 else '備後'
    if pid == 33:  # 岡山：備前・美作
        return '美作' if lat > 34.95 else '備前'
    if pid == 28:  # 兵庫：但馬・丹波・淡路・播磨
        if lat > 35.15:
            return '但馬'
        if 134.6 < lon < 135.05 and 34.1 < lat < 34.65:
            return '淡路'
        if lon > 134.85 and lat > 34.95:
            return '丹波'
        return '播磨'
    if pid == 26:  # 京都：丹後・丹波・山城
        if lat > 35.35:
            return '丹後'
        if lat > 34.95 and lon < 135.55:
            return '丹波'
        return '山城'
    if pid == 27:  # 大阪：摂津・河内・和泉
        if lat > 34.7:
            return '摂津'
        return '河内' if lon > 135.5 else '和泉'
    if pid == 25:
        return '近江'
    if pid == 24:  # 三重：伊賀・伊勢
        return '伊賀' if lon < 136.3 and lat < 34.95 and lat > 34.55 else '伊勢'
    if pid == 18:  # 福井：若狭・越前
        return '若狭' if lon < 136.0 and lat < 35.72 else '越前'
    if pid == 17:  # 石川：加賀・能登
        return '能登' if lat > 36.85 else '加賀'
    if pid == 23:  # 愛知：尾張・三河
        return '尾張' if lon < 137.18 else '三河'
    if pid == 22:  # 静岡：遠江・駿河・伊豆
        if lon > 138.75:
            return '伊豆'
        return '遠江' if lon < 138.2 else '駿河'
    if pid == 12:  # 千葉：安房・上総・下総
        if lat < 35.15:
            return '安房'
        return '上総' if lat < 35.55 else '下総'
    if pid == 7:  # 福島：磐城・岩代・会津
        if lon > 140.65:
            return '磐城'
        return '会津' if lon < 140.1 else '岩代'
    if pid == 4:  # 宮城
        return '陸前'
    if pid == 3:  # 岩手
        return '陸奥' if lat > 40.0 else '陸中'
    if pid == 2:  # 青森：津軽・陸奥
        return '津軽' if lon < 141.0 else '陸奥'
    if pid == 6:  # 山形：庄内・出羽
        return '庄内' if lon < 140.0 else '出羽'
    if pid == 5:  # 秋田
        return '羽後'
    return None


def km(lon1, lat1, lon2, lat2):
    return math.hypot((lon1 - lon2) * 111 * KX, (lat1 - lat2) * 111)


kuni = [[None] * COLS for _ in range(ROWS)]
lonlat = [[None] * COLS for _ in range(ROWS)]
for r in range(ROWS):
    for c in range(COLS):
        gx = GX0 + (c + 0.5) * CELL
        gy = GY1 - (r + 0.5) * CELL
        lon, lat = to_lonlat(gx, gy)
        lonlat[r][c] = (lon, lat)
        votes = {}
        for dx, dy in ((0, 0), (0.3, 0.3), (-0.3, 0.3), (0.3, -0.3), (-0.3, -0.3)):
            lo, la = to_lonlat(gx + dx * CELL, gy + dy * CELL)
            pid = sample(lo, la)
            votes[pid] = votes.get(pid, 0) + 1
        pid = max(votes, key=votes.get)
        if pid:
            kuni[r][c] = kuni_of(pid, lon, lat)


def neighbors(r, c):
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            if dr or dc:
                rr, cc = r + dr, c + dc
                if 0 <= rr < ROWS and 0 <= cc < COLS:
                    yield rr, cc


# 小さすぎる島（つながった陸が 3 マス未満）は消す
seen = set()
for r in range(ROWS):
    for c in range(COLS):
        if kuni[r][c] and (r, c) not in seen:
            comp = [(r, c)]
            seen.add((r, c))
            i = 0
            while i < len(comp):
                for rr, cc in neighbors(*comp[i]):
                    if kuni[rr][cc] and (rr, cc) not in seen:
                        seen.add((rr, cc))
                        comp.append((rr, cc))
                i += 1
            if len(comp) < 3:
                for rr, cc in comp:
                    kuni[rr][cc] = None

# 陸のある範囲だけ残す（周りに 2 マスの海）
rows_with = [r for r in range(ROWS) if any(kuni[r])]
cols_with = [c for c in range(COLS) if any(kuni[r][c] for r in range(ROWS))]
r0, r1 = max(0, rows_with[0] - 2), min(ROWS - 1, rows_with[-1] + 2)
c0, c1 = max(0, cols_with[0] - 2), min(COLS - 1, cols_with[-1] + 2)
kuni = [row[c0:c1 + 1] for row in kuni[r0:r1 + 1]]
lonlat = [row[c0:c1 + 1] for row in lonlat[r0:r1 + 1]]
ROWS = len(kuni)
COLS = len(kuni[0])

# ------------------------------------------------------------------ 城と領地

castle_cell = {}
for cid, name, k, lon, lat in CASTLES:
    best = None
    for r in range(ROWS):
        for c in range(COLS):
            if kuni[r][c] != k:
                continue
            d = km(lon, lat, *lonlat[r][c])
            if best is None or d < best[0]:
                best = (d, c, r)
    if best is None:
        raise SystemExit(f'{name}（{k}）のある国にマスがない')
    castle_cell[cid] = (best[1], best[2])

# 同じ国の中で、いちばん近い城の領地にする（マス目上の距離）
owner = [[None] * COLS for _ in range(ROWS)]
by_kuni = {}
for cid, name, k, lon, lat in CASTLES:
    by_kuni.setdefault(k, []).append(cid)
for r in range(ROWS):
    for c in range(COLS):
        k = kuni[r][c]
        if not k:
            continue
        if k not in by_kuni:
            raise SystemExit(f'{k} に城がない')
        best = None
        for cid in by_kuni[k]:
            cc, cr = castle_cell[cid]
            d = math.hypot(cc - c, cr - r)
            if best is None or d < best[0]:
                best = (d, cid)
        owner[r][c] = best[1]

# 領地が 1 つの城に飛び地なくつながるように、城から届かないマスは近い城に付け替える
def reachable(cid):
    cc, cr = castle_cell[cid]
    seen = {(cr, cc)}
    stack = [(cr, cc)]
    while stack:
        r, c = stack.pop()
        for rr, ccc in neighbors(r, c):
            if owner[rr][ccc] == cid and (rr, ccc) not in seen:
                seen.add((rr, ccc))
                stack.append((rr, ccc))
    return seen


for _ in range(3):
    for cid, name, k, lon, lat in CASTLES:
        ok = reachable(cid)
        for r in range(ROWS):
            for c in range(COLS):
                if owner[r][c] == cid and (r, c) not in ok:
                    # 隣の領地のうち、いちばん多いものに付け替える
                    cnt = {}
                    for rr, cc in neighbors(r, c):
                        o = owner[rr][cc]
                        if o and o != cid:
                            cnt[o] = cnt.get(o, 0) + 1
                    if cnt:
                        owner[r][c] = max(cnt, key=cnt.get)

# 隣接
adj = set()
for r in range(ROWS):
    for c in range(COLS):
        a = owner[r][c]
        if not a:
            continue
        for rr, cc in neighbors(r, c):
            b = owner[rr][cc]
            if b and b != a:
                adj.add(tuple(sorted((a, b))))
ids = [c[0] for c in CASTLES]
for a, b in SEA_LINKS:
    if a not in ids or b not in ids:
        raise SystemExit(f'海路の城が不明: {a}-{b}')
links = sorted(adj) + [(a, b, 'sea') for a, b in SEA_LINKS if tuple(sorted((a, b))) not in adj]

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
ALPS = [(137.7, 36.0, 60), (138.6, 35.4, 25), (137.4, 35.5, 30)]

rng = random.Random(1560)
terrain = [['~'] * COLS for _ in range(ROWS)]
land = [[owner[r][c] is not None for c in range(COLS)] for r in range(ROWS)]
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
for cid, (c, r) in castle_cell.items():
    terrain[r][c] = '.'

# ------------------------------------------------------------------ 出力

counts = {}
for r in range(ROWS):
    for c in range(COLS):
        if owner[r][c]:
            counts[owner[r][c]] = counts.get(owner[r][c], 0) + 1
tiny = [(cid, counts.get(cid, 0)) for cid in ids if counts.get(cid, 0) < 6]
if tiny:
    print('マスの少ない城:', tiny, file=sys.stderr)

idx = {cid: i for i, cid in enumerate(ids)}
# 領地は 1 マス 2 文字の 16 進数（'~~' は海）
owner_rows = [''.join('~~' if owner[r][c] is None else f'{idx[owner[r][c]]:02x}' for c in range(COLS)) for r in range(ROWS)]
terr_rows = [''.join(terrain[r]) for r in range(ROWS)]

with open(OUT, 'w', encoding='utf-8') as f:
    f.write('/**\n * マス目の日本地図。tools/build-map.py が都道府県の地形データから作る（手で直さない）。\n')
    f.write(' *\n *   TERRAIN: 1 行 1 段。~ 海　. 平地　f 森　m 山\n')
    f.write(' *   PROVINCE: 同じ並びで 1 マス 2 文字。16 進数で CASTLE_INFO の何番目の城の領地か。~~ は海\n')
    f.write(' *   CASTLE_INFO: [id, 城名, 国, 列, 段, 本城か]\n *   LINKS: 隣り合う城（3 つ目が sea なら海路）\n */\n\n')
    f.write(f'export const COLS = {COLS};\nexport const ROWS = {ROWS};\n\n')
    f.write('export const CASTLE_INFO = [\n')
    mains = set()
    for cid, name, k, lon, lat in CASTLES:
        main = k not in mains
        mains.add(k)
        c, r = castle_cell[cid]
        f.write(f"  ['{cid}', '{name}', '{k}', {c}, {r}, {'true' if main else 'false'}],\n")
    f.write('];\n\n')
    f.write('export const LINKS = [\n')
    for l in links:
        f.write(f"  [{', '.join(repr(x) for x in l)}],\n".replace("'", "'"))
    f.write('];\n\n')
    f.write('export const TERRAIN = [\n' + ''.join(f"  '{row}',\n" for row in terr_rows) + '];\n\n')
    f.write('export const PROVINCE = [\n' + ''.join(f"  '{row}',\n" for row in owner_rows) + '];\n')

total = sum(counts.values())
print(f'{COLS} x {ROWS} マス、陸 {total} マス、城 {len(ids)}、隣接 {len(links)}')
for cid, name, k, lon, lat in CASTLES:
    print(f'  {cid:12s} {name:8s} {k:4s} {counts.get(cid, 0):4d}')
