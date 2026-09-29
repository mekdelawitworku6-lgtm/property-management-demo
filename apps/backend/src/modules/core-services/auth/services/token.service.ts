import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import { safeEqual, sha256 } from '../../../../common/utils/crypto.util';
import type { JwtPayload } from '../../../../common/strategies/jwt.strategy';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /** Issues an access + refresh pair and stores the refresh-token hash (rotation). */
  async issueTokens(user: Pick<User, 'id' | 'role' | 'sessionVersion'>): Promise<AuthTokens> {
    const base = { sub: user.id, role: user.role, sv: user.sessionVersion };
    const expiresIn = this.configService.get<string>('JWT_EXPIRES_IN', '1d');
    const accessToken = await this.jwtService.signAsync({ ...base, type: 'access' } satisfies JwtPayload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      expiresIn,
    });
    const refreshToken = await this.jwtService.signAsync({ ...base, type: 'refresh' } satisfies JwtPayload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '30d'),
    });
    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshTokenHash: sha256(refreshToken) },
    });
    return { accessToken, refreshToken, tokenType: 'Bearer', expiresIn };
  }

  /** Validates a refresh token against its signature, session version and stored hash. */
  async verifyRefreshToken(refreshToken: string): Promise<User> {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (payload.type !== 'refresh') throw new UnauthorizedException('Invalid token type');
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (
      !user ||
      user.isSuspended ||
      user.sessionVersion !== payload.sv ||
      !user.refreshTokenHash ||
      !safeEqual(user.refreshTokenHash, sha256(refreshToken))
    ) {
      throw new UnauthorizedException('Refresh token revoked');
    }
    return user;
  }

  /** Invalidates all outstanding access + refresh tokens for the user. */
  async revokeAll(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { sessionVersion: { increment: 1 }, refreshTokenHash: null },
    });
  }
}
