# -*- coding: utf-8 -*-
"""
生成 PWA 图标（192 / 512 PNG）。
仅用 Python 标准库（zlib + struct），无需联网安装任何包。
设计：靛蓝圆角方块 + 三根白色柱状（寓意"看板/仪表盘"）。

用法：
  python 生成PWA图标.py
产物：仓库根目录 icon-192.png / icon-512.png
"""
import os
import zlib
import struct

# 输出到本脚本所在目录的上一级（仓库根目录）
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BG = (0x4F, 0x46, 0xE5)   # 靛蓝 #4f46e5，与工作台主题色一致
BAR = (255, 255, 255)     # 白色柱


def png_chunk(tag, data):
    chunk = tag + data
    return struct.pack('>I', len(data)) + chunk + struct.pack('>I', zlib.crc32(chunk) & 0xffffffff)


def write_png(path, size, pixels):
    raw = bytearray()
    for row in pixels:
        raw.append(0)  # filter type 0 (None)
        for (r, g, b, a) in row:
            raw.extend([r, g, b, a])
    compressed = zlib.compress(bytes(raw), 9)
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    png = sig + png_chunk(b'IHDR', ihdr) + png_chunk(b'IDAT', compressed) + png_chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


def rounded_rect_mask(size, r):
    """生成圆角矩形遮罩（True=在形状内）。"""
    mask = [[False] * size for _ in range(size)]
    for y in range(size):
        for x in range(size):
            if x >= r or y >= r:
                mask[y][x] = True
            else:
                dx = r - x
                dy = r - y
                if (dx * dx) / (r * r) + (dy * dy) / (r * r) <= 1.0:
                    mask[y][x] = True
    return mask


def gen_icon(size, path):
    s = size
    r = int(s * 0.22)
    bgmask = rounded_rect_mask(s, r)

    # 三根白色柱状（看板/进度条意象），底部对齐、高度不一
    n = 3
    gap = s * 0.07
    bar_w = (s * 0.62 - gap * (n - 1)) / n
    base_y = int(s * 0.82)
    heights = [s * 0.36, s * 0.52, s * 0.44]
    total_w = n * bar_w + (n - 1) * gap
    start_x = (s - total_w) / 2

    bars = []
    for i in range(n):
        x0 = int(start_x + i * (bar_w + gap))
        x1 = int(x0 + bar_w)
        y0 = int(base_y - heights[i])
        y1 = base_y
        bars.append((x0, y0, x1, y1))

    pixels = []
    for y in range(s):
        row = []
        for x in range(s):
            if not bgmask[y][x]:
                row.append((0, 0, 0, 0))  # 圆角外透明
                continue
            inbar = False
            for (x0, y0, x1, y1) in bars:
                if x0 <= x < x1 and y0 <= y < y1:
                    inbar = True
                    break
            row.append(BAR + (255,) if inbar else BG + (255,))
        pixels.append(row)

    write_png(path, s, pixels)
    print('已生成:', path, '(%dx%d)' % (s, s))


if __name__ == '__main__':
    gen_icon(192, os.path.join(ROOT, 'icon-192.png'))
    gen_icon(512, os.path.join(ROOT, 'icon-512.png'))
