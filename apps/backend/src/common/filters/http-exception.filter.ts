import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { buildErrorResponse, extractExceptionMessage } from '../utils/api-response.util';

/** Maps Prisma known request errors to HTTP status + message. */
export function mapPrismaError(error: Prisma.PrismaClientKnownRequestError): {
  status: number;
  message: string;
} {
  switch (error.code) {
    case 'P2002': {
      const target = (error.meta?.target as string[] | string) ?? 'field';
      return {
        status: HttpStatus.CONFLICT,
        message: `A record with this ${Array.isArray(target) ? target.join(', ') : target} already exists`,
      };
    }
    case 'P2025':
      return { status: HttpStatus.NOT_FOUND, message: 'Record not found' };
    case 'P2003':
      return { status: HttpStatus.BAD_REQUEST, message: 'Related record does not exist' };
    default:
      return { status: HttpStatus.BAD_REQUEST, message: 'Database request failed' };
  }
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: string[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const extracted = extractExceptionMessage(exception.getResponse(), exception.message);
      message = extracted.message;
      errors = extracted.errors;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      ({ status, message } = mapPrismaError(exception));
    } else if (exception instanceof Error) {
      message = process.env.NODE_ENV === 'production' ? message : exception.message;
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(`${request?.method} ${request?.url}: ${(exception as Error)?.stack ?? exception}`);
    }

    response.status(status).json(buildErrorResponse(status, message, errors));
  }
}
