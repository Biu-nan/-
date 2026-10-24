import sys
from PIL import Image

# 生成 160x160（或指定边长）缩略图，白底填充，用于「搜索列表缩略图仍可识别」的可验证判定
src, dst, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
limit = int(sys.argv[4]) if len(sys.argv) > 4 else 600 * 1024

im = Image.open(src).convert("RGB")
im.thumbnail((size, size), Image.LANCZOS)
canvas = Image.new("RGB", (size, size), (255, 255, 255))
canvas.paste(im, ((size - im.width) // 2, (size - im.height) // 2))

quality = 85
while quality >= 40:
    canvas.save(dst, "JPEG", quality=quality, optimize=True)
    import os
    if os.path.getsize(dst) <= limit:
        break
    quality -= 10
print(f"{im.width}x{im.height}@{quality}")
