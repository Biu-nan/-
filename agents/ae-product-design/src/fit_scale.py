import json
import sys

from PIL import Image

# 纯白底商品图的主体占比校正：
# 1) 用亮度阈值求非背景 bbox（含物体与投影）
# 2) 四角必须近白，否则判定"非白底图"，直接跳过（绝不给人造白边）
# 3) 占比超过上限时，按 target 扩画布并居中粘贴 —— 商品像素不缩放，只补白
# 用法: fit_scale.py <src> <min> <max> <target> [white_threshold]

src = sys.argv[1]
min_scale = float(sys.argv[2])
max_scale = float(sys.argv[3])
target_scale = float(sys.argv[4])
white_threshold = int(sys.argv[5]) if len(sys.argv) > 5 else 240

img = Image.open(src).convert("RGB")
width, height = img.size

gray = img.convert("L")
# 255 = 主体（亮度低于阈值），0 = 背景
mask = gray.point(lambda p: 0 if p >= white_threshold else 255)
bbox = mask.getbbox()

result = {
    "file": src,
    "sizeBefore": [width, height],
    "subjectScaleBefore": None,
    "subjectScaleAfter": None,
    "action": "skip",
    "reason": None,
}

if bbox is None:
    result["reason"] = "no-subject-detected"
    print(json.dumps(result))
    sys.exit(0)

left, top, right, bottom = bbox
subject_w = max(1, right - left)
subject_h = max(1, bottom - top)
scale_w = subject_w / width
scale_h = subject_h / height
current = max(scale_w, scale_h)
result["subjectScaleBefore"] = round(current, 4)
result["bbox"] = [left, top, right, bottom]

# 四角近白检查：任一角明显非白 → 视为场景/彩色底图，不补白
corners = [
    img.getpixel((2, 2)),
    img.getpixel((width - 3, 2)),
    img.getpixel((2, height - 3)),
    img.getpixel((width - 3, height - 3)),
]
min_corner = min(min(c) for c in corners)
result["cornerMin"] = min_corner
if min_corner < white_threshold - 4:
    result["reason"] = "not-white-background"
    print(json.dumps(result))
    sys.exit(0)

if current <= max_scale:
    result["reason"] = "already-in-range"
    result["subjectScaleAfter"] = round(current, 4)
    print(json.dumps(result))
    sys.exit(0)

factor = current / target_scale
new_w = int(round(width * factor))
new_h = int(round(height * factor))
canvas = Image.new("RGB", (new_w, new_h), (255, 255, 255))
canvas.paste(img, ((new_w - width) // 2, (new_h - height) // 2))

# 占比复核：整体放大画布后，主体在新画布中的占比应≈target
verified = max(subject_w / new_w, subject_h / new_h)
canvas.save(src, "JPEG", quality=90, optimize=True)

result.update(
    {
        "sizeAfter": [new_w, new_h],
        "subjectScaleAfter": round(verified, 4),
        "action": "padded",
        "target": target_scale,
    }
)
print(json.dumps(result))
