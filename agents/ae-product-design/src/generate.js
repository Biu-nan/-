// agents/ae-product-design/src/generate.js
// S6：逐槽位出图。每槽位独立对话 + 重传产品图（F-11 防御）。

import { mkdir } from "node:fs/promises";
import path from "node:path";

export async function generateSlot({ model, slot, prompt, imagesDir, productImages, attempt }) {
  await mkdir(imagesDir, { recursive: true });
  const outputPath = path.join(imagesDir, `${slot.id}.jpg`);
  await model.generateImage({
    slotId: slot.id,
    attempt,
    prompt,
    outputPath,
    productImages,
  });
  return outputPath;
}

const SHOT_HINT = {
  full: "Shot type: full product view, the entire product visible in frame.",
  macro: "Shot type: extreme close-up macro. The frame shows ONLY a small portion of the product, filling the whole frame edge to edge. The complete product silhouette, the pot and the top leaves must NOT be visible. Never render a full product shot.",
  lifestyle: "Shot type: lifestyle scene with the product in a real usage context.",
  diagram: "Shot type: annotated diagram, product with dimension lines and readable numbers.",
  flatlay: "Shot type: flat-lay top-down arrangement of the product and included parts.",
};

/** 每张图带上的硬性保真前缀：模型常忽略 prompt 中段的约束，放在最前面最稳 */
export function guardPrompt(prompt, slot, { skuLock = "" } = {}) {
  const allowedText = (slot.textAllowed ?? []).filter(Boolean);
  const textBan =
    slot.textPolicy === "forbidden" || allowedText.length === 0
      ? "This image must contain absolutely no text, no letters, no numbers, no watermark, no logo and no border."
      : `Allowed text only: ${allowedText.join(", ")}. No other text, no watermark.`;
  // 主体占比写成硬指标：模型容易把商品撑满画面（实测 88% > 85% 上限被判 fail）
  const framing = slot.cropExpected
    ? `Framing: the visible product detail fills ${slot.productScale} of the frame edge to edge. The product is intentionally cropped by the frame edge; a tight crop is required, not a full product view.`
    : slot.productScale
      ? `Framing: the product occupies about ${slot.productScale} of the frame, with clean visible background margin on all four sides. Do not crop the product.`
      : "";
  return [
    "Generate one single image now, using the uploaded product photos as the only product reference.",
    "Use the uploaded product photos as the single source of truth for the product.",
    "Keep the product exactly as in the reference image: do not redesign, recolor, resize or reletter any part of it.",
    skuLock ? `SKU lock — ${skuLock.replace(/\n/g, " ")}` : "",
    SHOT_HINT[slot.shot] ?? "",
    slot.focusHint ? `Focus on ${slot.focusHint}.` : "",
    textBan,
    framing,
    "",
    prompt,
  ]
    .filter(Boolean)
    .join("\n");
}
