// agents/ae-product-design/src/readiness.js
// 数据就绪守卫：缺尺寸/配件信息时跳过槽位，而不是让模型编造规格。

export function slotDataReadiness(slot, facts) {
  const variants = facts?.variants ?? {};
  const dims = Array.isArray(variants.dimensions) ? variants.dimensions : [];
  const sizes = Array.isArray(variants.sizes) ? variants.sizes : [];
  const colors = Array.isArray(variants.colors) ? variants.colors : [];
  const attrs = JSON.stringify(facts?.keyAttributes ?? []);
  const hasDimension = dims.length > 0 || sizes.length > 0 || /size|dimension|length|width|height|尺寸/i.test(attrs);

  if (slot.role === "dimension" && !hasDimension) {
    return { ready: false, reason: "product-facts 缺少尺寸/规格数据，跳过以避免编造尺寸" };
  }
  if (slot.role === "confirmation") {
    const hasBox =
      colors.length > 0 || sizes.length > 0 || attrs.length > 8 || Boolean(facts?.packageIncludes);
    if (!hasBox) {
      return { ready: false, reason: "product-facts 无款式/配件/限制信息，跳过以避免编造到手清单" };
    }
  }
  return { ready: true };
}
