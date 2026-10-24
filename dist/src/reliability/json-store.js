import { constants } from "node:fs";
import { copyFile, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { enqueueFileWrite } from "../json-write-queue.js";

function decode(raw, file, validate) {
  try {
    const value = JSON.parse(raw);
    if (validate && validate(value) !== true) throw new Error("JSON结构不符合要求");
    return value;
  } catch (cause) {
    const error = new Error(`状态文件无效，已保留原文件：${file}`, { cause });
    error.code = "E_JSON_INVALID";
    throw error;
  }
}

async function readExisting(file) {
  try { return await readFile(file, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function atomicReplace(file, raw) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  let created = false;
  try {
    handle = await open(temporary, "wx", 0o600);
    created = true;
    await handle.writeFile(raw, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, file);
  } finally {
    if (handle) await handle.close();
    if (created) await unlink(temporary).catch(error => {
      if (error.code !== "ENOENT") console.warn("临时状态文件清理失败：", error.code);
    });
  }
}

export function readCheckedJson(file, { validate } = {}) {
  file = path.resolve(file);
  return enqueueFileWrite(file, async () => {
    const raw = await readExisting(file);
    let primaryError;
    if (raw !== null) {
      try { return { found: true, value: decode(raw, file, validate), recovered: false }; }
      catch (error) { primaryError = error; }
    }
    // 权限/IO错误由readExisting直接抛出，不能用快照掩盖。
    const backup = await readExisting(`${file}.backup`);
    if (backup === null) {
      if (primaryError) throw primaryError;
      return { found: false, recovered: false };
    }
    let value;
    try { value = decode(backup, `${file}.backup`, validate); }
    catch (error) { throw primaryError ?? error; }
    let preservedPath;
    if (raw !== null) {
      preservedPath = `${file}.corrupt-${Date.now()}-${randomUUID()}`;
      await copyFile(file, preservedPath, constants.COPYFILE_EXCL);
    }
    await atomicReplace(file, backup);
    return { found: true, value, recovered: true, preservedPath };
  });
}

export function writeCheckedJson(file, value, { validate } = {}) {
  file = path.resolve(file);
  // 先序列化并验证，失败不得污染主文件或有效快照。
  const raw = `${JSON.stringify(value, null, 2)}\n`;
  decode(raw, file, validate);
  return enqueueFileWrite(file, async () => {
    const previous = await readExisting(file);
    if (previous !== null) {
      decode(previous, file, validate);
      await atomicReplace(`${file}.backup`, previous);
    }
    await atomicReplace(file, raw);
  });
}
