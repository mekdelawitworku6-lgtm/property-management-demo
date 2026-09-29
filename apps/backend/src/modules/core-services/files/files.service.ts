import { BadRequestException, Injectable } from '@nestjs/common';
import { buildPublicUrl } from './file-upload.util';

export interface UploadedFileInfo {
  url: string;
  originalName: string;
  mimeType: string;
  size: number;
}

@Injectable()
export class FilesService {
  /** Maps multer-saved files to public URLs served under /uploads. */
  describeUploads(folder: string, files: Express.Multer.File[]): UploadedFileInfo[] {
    if (!files?.length) throw new BadRequestException('No files uploaded (field name: "files")');
    return files.map((file) => ({
      url: buildPublicUrl(folder, file.filename),
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    }));
  }
}
