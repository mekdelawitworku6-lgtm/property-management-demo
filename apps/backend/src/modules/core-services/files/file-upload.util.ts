import { BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { extname } from 'path';

export const UPLOAD_ROOT = 'uploads';
export const UPLOAD_FOLDERS = ['properties', 'units', 'complaints', 'agreements', 'receipts', 'work-orders', 'kyc'] as const;
export type UploadFolder = (typeof UPLOAD_FOLDERS)[number];
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_REQUEST = 10;

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']);

export function isUploadFolder(folder: string): folder is UploadFolder {
  return (UPLOAD_FOLDERS as readonly string[]).includes(folder);
}

export function isAllowedMimeType(mimeType: string): boolean {
  return ALLOWED_MIME_TYPES.has(mimeType);
}

/** Random, collision-free file name that keeps the (lower-cased) extension. */
export function buildStoredFileName(originalName: string, now = Date.now()): string {
  const ext = extname(originalName || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8);
  return `${now}-${randomBytes(6).toString('hex')}${ext}`;
}

export function buildPublicUrl(folder: string, fileName: string): string {
  return `/${UPLOAD_ROOT}/${folder}/${fileName}`;
}

/** Multer fileFilter: accept images + PDFs only. */
export function fileFilter(
  _req: unknown,
  file: { mimetype: string },
  callback: (error: Error | null, accept: boolean) => void,
): void {
  if (!isAllowedMimeType(file.mimetype)) {
    callback(new BadRequestException(`Unsupported file type: ${file.mimetype}`), false);
    return;
  }
  callback(null, true);
}
