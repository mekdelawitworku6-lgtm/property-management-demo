import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { UserRole } from '@prisma/client';
import type { Server, Socket } from 'socket.io';
import type { RealtimeEvent } from '../../../common/constants/events.constants';

export const STAFF_ROOM = 'staff';
export const userRoom = (userId: string) => `user:${userId}`;

/**
 * Real-time sync between the Tenant App, Owner Dashboard and Admin Dashboard (Section 4.4).
 * Clients connect to `/realtime` with `auth: { token: <accessToken> }` and receive events
 * for records they are party to.
 */
@WebSocketGateway({ namespace: '/realtime', cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  extractToken(client: Socket): string | null {
    const authToken = client.handshake?.auth?.token as string | undefined;
    const header = client.handshake?.headers?.authorization as string | undefined;
    const queryToken = client.handshake?.query?.token as string | undefined;
    const raw = authToken || header || queryToken;
    if (!raw) return null;
    return raw.startsWith('Bearer ') ? raw.slice(7) : raw;
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = this.extractToken(client);
      if (!token) throw new Error('Missing token');
      const payload = await this.jwtService.verifyAsync<{ sub: string; role: UserRole; type: string }>(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
      if (payload.type !== 'access') throw new Error('Invalid token type');
      client.data.userId = payload.sub;
      client.data.role = payload.role;
      await client.join(userRoom(payload.sub));
      if (payload.role === UserRole.ADMIN || payload.role === UserRole.TELECOM) {
        await client.join(STAFF_ROOM);
      }
    } catch (error) {
      this.logger.debug(`Rejected socket ${client.id}: ${(error as Error).message}`);
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Socket ${client.id} disconnected`);
  }

  /** Pushes an event to each user's private room. Safe to call before the server is ready. */
  emitToUsers(userIds: Array<string | null | undefined>, event: RealtimeEvent, payload: unknown): void {
    if (!this.server) return;
    const unique = [...new Set(userIds.filter(Boolean))] as string[];
    for (const id of unique) this.server.to(userRoom(id)).emit(event, payload);
  }

  /** Pushes an event to all connected platform staff (Admin + Ethio Telecom). */
  emitToStaff(event: RealtimeEvent, payload: unknown): void {
    if (!this.server) return;
    this.server.to(STAFF_ROOM).emit(event, payload);
  }
}
