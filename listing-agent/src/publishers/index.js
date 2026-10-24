// ListingPublisher 端口：接口定义 + 简单注册表。
// agent 核心只认本文件导出的接口形态，上架实现可插拔。
//
// @typedef {import("../types.js").ListingPublisher} ListingPublisher
 */

export const publishers = new Map();

/**
 * 注册一个 publisher 实现。
 * @param {string} name
 * @param {object} impl ListingPublisher
 */
export function registerPublisher(name, impl) {
  publishers.set(name, impl);
}

/**
 * 取已注册的 publisher。
 * @param {string} [name]
 * @returns {object|undefined}
 */
export function getPublisher(name) {
  return name ? publishers.get(name) : undefined;
}
