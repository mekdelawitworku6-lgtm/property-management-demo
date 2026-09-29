import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import helmet from 'helmet';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

/** Applies global pipes/filters/interceptors — shared by main.ts and e2e tests. */
export function configureApp(app: NestExpressApplication): void {
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.useBodyParser('text', { type: ['text/xml', 'application/xml'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalInterceptors(new TransformInterceptor(app.get(Reflector)));
  app.useGlobalFilters(new HttpExceptionFilter());
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  const config = app.get(ConfigService);

  const uploadsDir = join(process.cwd(), 'uploads');
  mkdirSync(uploadsDir, { recursive: true });

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(compression());
  app.useStaticAssets(uploadsDir, { prefix: '/uploads' });

  const origins = (config.get<string>('CORS_ORIGINS') ?? '*')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins.includes('*') ? true : origins, credentials: true });

  configureApp(app);
  app.useGlobalInterceptors(new LoggingInterceptor());

  const swagger = new DocumentBuilder()
    .setTitle('Property Management Platform API')
    .setDescription(
      'Shared backend for the Owner Dashboard, Tenant App (Flutter) and Admin Control Dashboard. ' +
        'Bilingual (Amharic/English), Telebirr + bank + cash payments with Ethio Telecom confirmation, ' +
        'real-time sync via Socket.IO namespace /realtime.',
    )
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger));

  const port = config.get<number>('PORT', 4100);
  await app.listen(port, '0.0.0.0');
  logger.log(`API listening on :${port} — docs at /api/docs`);
}

if (require.main === module) {
  void bootstrap();
}
