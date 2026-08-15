import {
  BadRequestException,
  Controller,
  HttpException,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SalesImportService } from './sales-import.service';

interface UploadedFile {
  filename: string;
  buffer: Buffer;
  fields: Record<string, string>;
}

@Controller('sales/import')
@UseGuards(AuthGuard)
export class SalesImportController {
  constructor(private readonly importer: SalesImportService) {}

  @Post('preview')
  async preview(
    @CurrentUser('id') userId: string,
    @Req() req: FastifyRequest,
  ) {
    const upload = await this.readSingleFile(req);
    this.assertExtension(upload.filename);
    const platform = upload.fields.platform;
    const workspaceId = upload.fields.workspace_id;
    if (platform !== 'hotmart') {
      throw new BadRequestException({ error: 'unsupported_platform' });
    }
    if (!workspaceId) {
      throw new BadRequestException({ error: 'missing_workspace_id' });
    }
    return this.importer.preview(upload.buffer, upload.filename, userId, workspaceId);
  }

  @Post()
  async commit(
    @CurrentUser('id') userId: string,
    @Req() req: FastifyRequest,
  ) {
    const upload = await this.readSingleFile(req);
    this.assertExtension(upload.filename);
    const platform = upload.fields.platform;
    const workspaceId = upload.fields.workspace_id;
    const integrationId = upload.fields.integration_id;
    if (platform !== 'hotmart') {
      throw new BadRequestException({ error: 'unsupported_platform' });
    }
    if (!workspaceId) {
      throw new BadRequestException({ error: 'missing_workspace_id' });
    }
    if (!integrationId) {
      throw new BadRequestException({ error: 'missing_integration_id' });
    }
    return this.importer.import(upload.buffer, upload.filename, userId, workspaceId, integrationId);
  }

  private async readSingleFile(req: FastifyRequest): Promise<UploadedFile> {
    // @ts-expect-error — multipart decorator provided by @fastify/multipart
    if (!req.isMultipart()) {
      throw new BadRequestException({ error: 'expected_multipart' });
    }

    const fields: Record<string, string> = {};
    let filename = '';
    const chunks: Buffer[] = [];

    // @ts-expect-error — parts() provided by @fastify/multipart
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        filename = part.filename;
        for await (const chunk of part.file) chunks.push(chunk as Buffer);
        if ((part.file as any).truncated) {
          throw new HttpException({ error: 'file_too_large', max_bytes: 5 * 1024 * 1024 }, 413);
        }
      } else if (part.type === 'field') {
        fields[part.fieldname] = String(part.value ?? '');
      }
    }

    if (!filename || chunks.length === 0) {
      throw new BadRequestException({ error: 'file_missing' });
    }

    return { filename, buffer: Buffer.concat(chunks), fields };
  }

  private assertExtension(filename: string): void {
    if (!/\.(csv|xlsx)$/i.test(filename)) {
      throw new BadRequestException({ error: 'unsupported_format' });
    }
  }
}
