import json
import sys

from PIL import Image

# 精确尺寸化：等比缩放到目标框内，剩余部分补白，绝不拉伸变形。
# 用法: exact_size.py <file> <width> <height>

file, target_w, target_h = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])

im = Image.open(file).convert("RGB")
before = im.size

scale = min(target_w / im.width, target_h / im.height)
new_size = (max(1, round(im.width * scale)), max(1, round(im.height * scale)))
resized = im.resize(new_size, Image.LANCZOS)

canvas = Image.new("RGB", (target_w, target_h), (255, 255, 255))
canvas.paste(resized, ((target_w - new_size[0]) // 2, (target_h - new_size[1]) // 2))
canvas.save(file, "JPEG", quality=92, optimize=True)

print(json.dumps({
    "file": file,
    "sizeBefore": list(before),
    "sizeAfter": [target_w, target_h],
    "contentSize": list(new_size),
    "padded": new_size != (target_w, target_h),
    "bytes": canvas and __import__("os").path.getsize(file),
}))
