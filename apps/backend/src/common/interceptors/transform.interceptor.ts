import { CallHandler, ExecutionContext, HttpStatus, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { formatControllerResponse } from '../utils/api-response.util';
import { RESPONSE_MESSAGE_KEY } from '../decorators/response-message.decorator';

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse();
    const message =
      this.reflector.get<string>(RESPONSE_MESSAGE_KEY, context.getHandler()) ??
      this.reflector.get<string>(RESPONSE_MESSAGE_KEY, context.getClass());

    return next.handle().pipe(
      map((data) => {
        // File downloads (reports) bypass the JSON envelope.
        if (data instanceof StreamableFile) return data;
        return formatControllerResponse(data, response?.statusCode || HttpStatus.OK, message);
      }),
    );
  }
}
