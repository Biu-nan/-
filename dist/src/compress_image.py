#!/usr/bin/env python
"""把图片压缩到 <= maxKB，原地覆盖（先写临时文件再替换，避免半截文件）。

设计约束（与一跨网站需求对齐）：
- 输出格式由输出文件扩展名决定：
  * .jpg / .jpeg -> JPEG（原尺寸，质量二分搜索到 <= maxKB；透明区域压平到白底，因为 JPEG 无透明通道）。
  * 其他（.png 等）-> PNG 有损调色板量化（256 -> 16 色），保留透明度。
- 不改尺寸、不改内容语义，仅降低文件体积。JPEG 可稳定压到 <=200KB；PNG 调色板对精细渲染图有体积下限（约 248KB）。
"""
import io
import os
import sys
import tempfile

from PIL import Image


def save_png(img, colors=None):
    buf = io.BytesIO()
    if colors is None:
        img.save(buf, format="PNG", optimize=True)
    else:
        quantized = img.quantize(colors=colors, method=Image.MEDIANCUT)
        quantized.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def _find_palette(base, max_bytes):
    """在 256..16 色之间二分，返回首个 <= max_bytes 的调色板结果；找不到则返回 16 色。"""
    lo, hi = 16, 256
    best = save_png(base, 16)
    if len(best) <= max_bytes:
        return best
    while lo <= hi:
        mid = (lo + hi) // 2
        data = save_png(base, mid)
        if len(data) <= max_bytes:
            best = data
            hi = mid - 1
        else:
            lo = mid + 1
    return best


def save_jpeg(rgb, quality):
    buf = io.BytesIO()
    rgb.save(buf, format="JPEG", quality=quality, optimize=True, progressive=True)
    return buf.getvalue()


def _find_jpeg(rgb, max_bytes):
    """质量 95->10 二分，返回首个 <= max_bytes 的 JPEG；找不到则返回质量 10。"""
    lo, hi = 10, 95
    best = save_jpeg(rgb, 95)
    if len(best) <= max_bytes:
        return best
    while lo <= hi:
        mid = (lo + hi) // 2
        data = save_jpeg(rgb, mid)
        if len(data) <= max_bytes:
            best = data
            lo = mid + 1
        else:
            hi = mid - 1
    return best


def _replace(outp, data, original_arg):
    if outp == original_arg:
        d = os.path.dirname(os.path.abspath(outp))
        fd, tmp = tempfile.mkstemp(dir=d, suffix=".tmp")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(data)
            os.replace(tmp, outp)
        except Exception:
            if os.path.exists(tmp):
                os.remove(tmp)
            raise
    else:
        with open(outp, "wb") as f:
            f.write(data)


def main():
    if len(sys.argv) < 3:
        sys.stderr.write("usage: compress_image.py <input> <maxKB> [output]\n")
        return 2
    inp = sys.argv[1]
    max_kb = int(sys.argv[2])
    outp = sys.argv[3] if len(sys.argv) > 3 else inp
    max_bytes = max_kb * 1024

    img = Image.open(inp)
    img.load()
    has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
    base = img.convert("RGBA") if has_alpha else img.convert("RGB")

    ext = outp.lower()
    is_jpg = ext.endswith(".jpg") or ext.endswith(".jpeg")
    if is_jpg:
        # JPEG 无透明通道：透明区域压平到白底（电商白底图惯例）
        if has_alpha:
            rgb = Image.alpha_composite(
                Image.new("RGBA", base.size, (255, 255, 255, 255)), base
            ).convert("RGB")
        else:
            rgb = base.convert("RGB")
        data = _find_jpeg(rgb, max_bytes)
        _replace(outp, data, inp)
        return 0

    # PNG 路径：无损优先，否则有损调色板二分
    data = save_png(base, None)
    if len(data) <= max_bytes:
        _replace(outp, data, inp)
        return 0
    data = _find_palette(base, max_bytes)
    _replace(outp, data, inp)
    return 0


if __name__ == "__main__":
    sys.exit(main())
