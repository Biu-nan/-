// agents/ae-product-design/src/image-info.js
// 零依赖读图片头解析宽高（PNG / JPEG / WebP），用于确定性尺寸校验。

import { open, stat } from "node:fs/promises";

const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function parsePng(buf) {
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), format: "png" };
}

function parseJpeg(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const size = buf.readUInt16BE(offset + 2);
    if (!size) return null;
    if (SOF_MARKERS.has(marker)) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7), format: "jpeg" };
    }
    offset += 2 + size;
  }
  return null;
}

function parseWebp(buf) {
  if (buf.length < 30) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return { width, height, format: "webp" };
  }
  if (chunk === "VP8 ") {
    const width = buf.readUInt16LE(26) & 0x3fff;
    const height = buf.readUInt16LE(28) & 0x3fff;
    return { width, height, format: "webp" };
  }
  if (chunk === "VP8L") {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, format: "webp" };
  }
  return null;
}

export async function readImageInfo(file) {
  const info = { file, bytes: 0, width: null, height: null, format: null, readable: false };
  try {
    const s = await stat(file);
    info.bytes = s.size;
    const handle = await open(file, "r");
    try {
      const buf = Buffer.alloc(Math.min(65536, Math.max(s.size, 0)));
      await handle.read(buf, 0, buf.length, 0);
      const parsed = parsePng(buf) ?? parseJpeg(buf) ?? parseWebp(buf);
      if (parsed) Object.assign(info, parsed, { readable: true });
    } finally {
      await handle.close();
    }
  } catch (error) {
    info.error = error?.message ?? String(error);
  }
  return info;
}

export function dimensionVerdict(info, spec) {
  const problems = [];
  if (!info.readable || !info.width || !info.height) {
    problems.push("无法解析尺寸");
    return { pass: false, problems, ratio: null, target: spec.aspect };
  }
  const targetRatio = spec.aspect === "3:4" ? 3 / 4 : 1;
  const actual = info.width / info.height;
  const tolerance = spec.ratioTolerance ?? 0.03;
  const delta = Math.abs(actual - targetRatio) / targetRatio;
  if (delta > tolerance) {
    problems.push(`比例 ${info.width}×${info.height} 不符合 ${spec.aspect}（允许偏差 ${(tolerance * 100).toFixed(0)}%）`);
  }
  if (spec.minWidth && info.width < spec.minWidth) problems.push(`宽 ${info.width}px < ${spec.minWidth}px`);
  if (spec.minHeight && info.height < spec.minHeight) problems.push(`高 ${info.height}px < ${spec.minHeight}px`);
  if (spec.minBytes && info.bytes < spec.minBytes) problems.push(`文件仅 ${info.bytes}B < ${spec.minBytes}B`);
  if (spec.maxBytes && info.bytes > spec.maxBytes) {
    problems.push(`文件 ${info.bytes}B（${(info.bytes / 1048576).toFixed(2)}MB）超过 ${(spec.maxBytes / 1048576).toFixed(1)}MB`);
  }
  return { pass: problems.length === 0, problems, ratio: Number(actual.toFixed(4)), target: spec.aspect };
}
