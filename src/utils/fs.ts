/**
 * File System Utilities - File and directory operations: create directories, write files, remove files/directories, path resolution
 */

import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";

export interface FsError extends Error {
  code: "FS_ERROR" | "PERMISSION_DENIED" | "NOT_FOUND" | "ALREADY_EXISTS";
  path?: string;
}

function createFsError(
  message: string,
  code: FsError["code"],
  fsPath?: string,
): FsError {
  const error = new Error(message) as FsError;
  error.code = code;
  error.path = fsPath;
  return error;
}

export async function ensureDirectory(
  dirPath: string,
  options: { recursive?: boolean } = {},
): Promise<void> {
  const { recursive = true } = options;

  try {
    await fs.mkdir(dirPath, { recursive });
  } catch (error: any) {
    if (error.code === "EEXIST") {
      return; // Directory already exists
    }
    throw createFsError(
      `Failed to create directory: ${error.message}`,
      "PERMISSION_DENIED",
      dirPath,
    );
  }
}

export function ensureDirectorySync(
  dirPath: string,
  options: { recursive?: boolean } = {},
): void {
  const { recursive = true } = options;

  try {
    if (!fsSync.existsSync(dirPath)) {
      fsSync.mkdirSync(dirPath, { recursive });
    }
  } catch (error: any) {
    throw createFsError(
      `Failed to create directory: ${error.message}`,
      "PERMISSION_DENIED",
      dirPath,
    );
  }
}

export async function writeFileWithDirectory(
  filePath: string,
  content: string,
  encoding: BufferEncoding = "utf8",
): Promise<void> {
  try {
    const dirPath = path.dirname(filePath);
    await ensureDirectory(dirPath);
    await fs.writeFile(filePath, content, encoding);
  } catch (error: any) {
    throw createFsError(
      `Failed to write file: ${error.message}`,
      "FS_ERROR",
      filePath,
    );
  }
}

export function writeFileWithDirectorySync(
  filePath: string,
  content: string,
  encoding: BufferEncoding = "utf8",
): void {
  try {
    const dirPath = path.dirname(filePath);
    ensureDirectorySync(dirPath);
    fsSync.writeFileSync(filePath, content, encoding);
  } catch (error: any) {
    throw createFsError(
      `Failed to write file: ${error.message}`,
      "FS_ERROR",
      filePath,
    );
  }
}

export async function removeFileOrDirectory(
  targetPath: string,
  options: { recursive?: boolean; force?: boolean } = {},
): Promise<void> {
  const { recursive = true, force = true } = options;

  // some checks to make sure the path is valid
  if (!path.isAbsolute(targetPath)) {
    throw createFsError(`Path is not absolute: ${targetPath}`, "FS_ERROR");
  }

  // must not be an upper directory eg ../
  if (targetPath.includes("..")) {
    throw createFsError(
      `Path contains upper directory: ${targetPath}`,
      "FS_ERROR",
    );
  }

  try {
    await fs.rm(targetPath, { recursive, force });
  } catch (error: any) {
    if (error.code === "ENOENT" && force) {
      return; // File/directory doesn't exist and force is true
    }
    throw createFsError(
      `Failed to remove: ${error.message}`,
      "FS_ERROR",
      targetPath,
    );
  }
}
