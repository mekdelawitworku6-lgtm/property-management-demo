import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { MessageKey, translate } from '../../../common/i18n/messages';
import { REALTIME_EVENTS } from '../../../common/constants/events.constants';
import { buildPaginatedList, resolvePagination } from '../../../common/utils/paginated-list.util';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SmsService } from '../../integrations/sms/sms.service';
import { TelegramService } from '../../integrations/telegram/telegram.service';
import { NotificationFilterDto } from './dto/notification-filter.dto';

export interface NotifyOptions {
  /** Also deliver by SMS (rent due / overdue / payment received / maintenance updates). */
  sms?: boolean;
  /** Arbitrary payload for the client (e.g. { agreementId }). */
  data?: Record<string, unknown>;
}

/**
 * In-app + SMS + optional Telegram notifications (Section 4.1.6), localized per
 * recipient language (Amharic / English).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly sms: SmsService,
    private readonly telegram: TelegramService,
  ) {}

  /** Notifies each user in their own language. Never throws. Returns the number notified. */
  async notify(
    userIds: Array<string | null | undefined>,
    key: MessageKey,
    params: Record<string, unknown> = {},
    options: NotifyOptions = {},
  ): Promise<number> {
    const ids = [...new Set(userIds.filter(Boolean))] as string[];
    if (!ids.length) return 0;
    try {
      const users = await this.prisma.user.findMany({
        where: { id: { in: ids }, isSuspended: false },
        select: { id: true, language: true, phoneNumber: true, telegramChatId: true },
      });
      for (const user of users) {
        const { title, body } = translate(key, user.language, params);
        const channels = ['IN_APP'];
        if (options.sms && (await this.sms.send(user.phoneNumber, body))) channels.push('SMS');
        if (user.telegramChatId && (await this.telegram.send(user.telegramChatId, `${title}\n${body}`))) {
          channels.push('TELEGRAM');
        }
        const notification = await this.prisma.notification.create({
          data: {
            userId: user.id,
            type: key,
            title,
            body,
            channels,
            data: (options.data ?? undefined) as Prisma.InputJsonValue,
          },
        });
        this.realtime.emitToUsers([user.id], REALTIME_EVENTS.NOTIFICATION, notification);
      }
      return users.length;
    } catch (error) {
      this.logger.error(`notify(${key}) failed: ${(error as Error).message}`);
      return 0;
    }
  }

  /** Notifies an owner together with all of their active managers. */
  async notifyOwner(
    ownerId: string,
    key: MessageKey,
    params: Record<string, unknown> = {},
    options: NotifyOptions = {},
  ): Promise<number> {
    const managers = await this.prisma.user.findMany({
      where: { employerId: ownerId, role: UserRole.MANAGER, isSuspended: false },
      select: { id: true },
    });
    return this.notify([ownerId, ...managers.map((m) => m.id)], key, params, options);
  }

  /** Notifies all platform staff with the given roles (defaults to ADMIN). */
  async notifyStaff(
    key: MessageKey,
    params: Record<string, unknown> = {},
    roles: UserRole[] = [UserRole.ADMIN],
    options: NotifyOptions = {},
  ): Promise<number> {
    const staff = await this.prisma.user.findMany({
      where: { role: { in: roles }, isSuspended: false },
      select: { id: true },
    });
    return this.notify(staff.map((s) => s.id), key, params, options);
  }

  async findAll(userId: string, filter: NotificationFilterDto = {}) {
    const { page, limit, skip, take } = resolvePagination(filter.page, filter.limit);
    const where: Prisma.NotificationWhereInput = { userId, ...(filter.unreadOnly ? { readAt: null } : {}) };
    const [docs, total] = await Promise.all([
      this.prisma.notification.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.prisma.notification.count({ where }),
    ]);
    return buildPaginatedList(docs, { page, limit, total });
  }

  async unreadCount(userId: string): Promise<{ unread: number }> {
    const unread = await this.prisma.notification.count({ where: { userId, readAt: null } });
    return { unread };
  }

  async markRead(userId: string, id: string) {
    const notification = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!notification) throw new NotFoundException('Notification not found');
    if (notification.readAt) return notification;
    return this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }
}
