// 乳贴必填字段规范 loader（agent 侧门面）。
import { loadRutieFieldSpec, getRutieRequiredFactLabels } from "../../../dist/src/listing-knowledge.js";

export { getRutieRequiredFactLabels };

let _cache = null;

/**
 * 加载乳贴必填字段规范（带缓存）。
 * @returns {Promise<object>}
 */
export async function loadFieldSpec() {
  if (!_cache) _cache = await loadRutieFieldSpec();
  return _cache;
}

/**
 * 取乳贴业务必填字段（产品事实可覆盖的部分）。
 * @returns {string[]}
 */
export function requiredFactLabels() {
  return getRutieRequiredFactLabels();
}
