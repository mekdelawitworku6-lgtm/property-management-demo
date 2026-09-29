import { BadRequestException } from '@nestjs/common';
import {
  buildPublicUrl, buildStoredFileName, fileFilter, isAllowedMimeType, isUploadFolder,
} from './file-upload.util';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';

describe('file-upload.util', () => {
  it('isUploadFolder accepts known folders only', () => {
    expect(isUploadFolder('complaints')).toBe(true);
    expect(isUploadFolder('../etc')).toBe(false);
  });

  it('isAllowedMimeType allows images and PDF', () => {
    expect(isAllowedMimeType('image/png')).toBe(true);
    expect(isAllowedMimeType('application/pdf')).toBe(true);
    expect(isAllowedMimeType('application/x-sh')).toBe(false);
  });

  it('buildStoredFileName keeps a sanitized extension', () => {
    expect(buildStoredFileName('Photo.JPG', 1)).toMatch(/^1-[0-9a-f]{12}\.jpg$/);
    expect(buildStoredFileName('noext', 1)).toMatch(/^1-[0-9a-f]{12}$/);
  });

  it('buildPublicUrl builds /uploads paths', () => {
    expect(buildPublicUrl('receipts', 'a.pdf')).toBe('/uploads/receipts/a.pdf');
  });

  it('fileFilter accepts or rejects by mime type', () => {
    const cb = jest.fn();
    fileFilter({}, { mimetype: 'image/jpeg' }, cb);
    expect(cb).toHaveBeenCalledWith(null, true);
    fileFilter({}, { mimetype: 'text/html' }, cb);
    expect(cb.mock.calls[1][0]).toBeInstanceOf(BadRequestException);
    expect(cb.mock.calls[1][1]).toBe(false);
  });
});

describe('FilesService / FilesController', () => {
  const service = new FilesService();
  const file = { filename: 'f.png', originalname: 'a.png', mimetype: 'image/png', size: 10 } as Express.Multer.File;

  it('describeUploads maps files to URLs and rejects empty uploads', () => {
    expect(service.describeUploads('units', [file])).toEqual([{ url: '/uploads/units/f.png', originalName: 'a.png', mimeType: 'image/png', size: 10 }]);
    expect(() => service.describeUploads('units', [])).toThrow(BadRequestException);
  });

  it('upload validates the folder and delegates', () => {
    const controller = new FilesController(service);
    expect(controller.upload('units', [file])).toHaveLength(1);
    expect(() => controller.upload('bad', [file])).toThrow('Invalid upload folder');
  });
});
