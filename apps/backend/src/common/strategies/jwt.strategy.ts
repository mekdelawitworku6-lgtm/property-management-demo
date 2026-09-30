import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../database/prisma.service';
import type { AuthUser } from '../types/auth-user.type';

export interface JwtPayload {
  sub: string;
  role: string;
  sv: number; // session version — bumped on logout / password change / suspension
  type: 'access' | 'refresh';
  jti?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
      passReqToCallback: true,
    });
  }

  async validate(req: { ip?: string }, payload: JwtPayload): Promise<AuthUser> {
    if (payload.type !== 'access') throw new UnauthorizedException('Invalid token type');
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException('User not found');
    if (user.isSuspended) throw new UnauthorizedException(user.suspendedReason ?? 'Account is suspended');
    if (user.sessionVersion !== payload.sv) {
      throw new UnauthorizedException('Session invalidated. Please login again.');
    }
    return {
      id: user.id,
      role: user.role,
      fullName: user.fullName,
      phoneNumber: user.phoneNumber,
      language: user.language,
      employerId: user.employerId,
      approvalStatus: user.approvalStatus,
      permissions: user.permissions,
      ip: req?.ip,
    };
  }
}
