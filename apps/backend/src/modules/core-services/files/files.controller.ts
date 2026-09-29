import { BadRequestException, Controller, Param, Post, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { FilesService } from './files.service';
import {
  MAX_FILES_PER_REQUEST,
  MAX_FILE_SIZE_BYTES,
  UPLOAD_FOLDERS,
  UPLOAD_ROOT,
  buildStoredFileName,
  fileFilter,
  isUploadFolder,
} from './file-upload.util';

@ApiTags('Files')
@ApiBearerAuth('access-token')
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload/:folder')
  @ApiOperation({ summary: 'Upload photos / documents (images or PDF, max 10 files × 10MB)' })
  @ApiParam({ name: 'folder', enum: UPLOAD_FOLDERS })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { files: { type: 'array', items: { type: 'string', format: 'binary' } } },
    },
  })
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES_PER_REQUEST, {
      storage: diskStorage({
        destination: (req, _file, cb) => {
          const folder = String(req.params.folder);
          if (!isUploadFolder(folder)) return cb(new BadRequestException('Invalid upload folder'), '');
          const dir = join(process.cwd(), UPLOAD_ROOT, folder);
          mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => cb(null, buildStoredFileName(file.originalname)),
      }),
      fileFilter,
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
    }),
  )
  upload(@Param('folder') folder: string, @UploadedFiles() files: Express.Multer.File[]) {
    if (!isUploadFolder(folder)) throw new BadRequestException('Invalid upload folder');
    return this.filesService.describeUploads(folder, files);
  }
}
