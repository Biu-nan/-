import sys

from PIL import Image

# 视觉模型输入预览图：只等比缩小，不补白、不裁切，保持真实比例
src, dst, size = sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 768

im = Image.open(src).convert("RGB")
im.thumbnail((size, size), Image.LANCZOS)
im.save(dst, "JPEG", quality=85, optimize=True)
print(f"{im.width}x{im.height}")
