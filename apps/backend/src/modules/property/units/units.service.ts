import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { UnitStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../../../common/constants/audit-actions.constants';
import { REALTIME_EVENTS } from '../../../common/constants/events.constants';
import { assertCanAccess } from '../../../common/utils/owner-scope.util';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { RealtimeGateway } from '../../core-services/realtime/realtime.gateway';
import { PropertiesService } from '../properties/properties.service';
import { CreateUnitDto, UpdateUnitDto } from './dto/unit.dto';

/** Manual status changes allowed from the dashboard; RESERVED/OCCUPIED are driven by agreements. */
export function assertManualStatusChange(current: UnitStatus, next: UnitStatus): void {
  const manual: UnitStatus[] = [UnitStatus.VACANT, UnitStatus.UNDER_MAINTENANCE];
  if (!manual.includes(next)) {
    throw new BadRequestException('Units become RESERVED/OCCUPIED only through rental agreements');
  }
  if (!manual.includes(current)) {
    throw new BadRequestException(`Cannot change status of a ${current} unit manually`);
  }
}

@Injectable()
export class UnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly propertiesService: PropertiesService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** FR-OWN-02: add units with rent amount, photos and terms. */
  async create(user: AuthUser, propertyId: string, dto: CreateUnitDto) {
    const property = await this.propertiesService.findOwned(user, propertyId);
    if (!property.isActive) throw new BadRequestException('Property is deactivated');
    const unit = await this.prisma.unit.create({ data: { ...dto, propertyId } });
    await this.audit.log(AUDIT_ACTIONS.UNIT_CREATED, 'Unit', unit.id, user, { propertyId, unitNumber: unit.unitNumber });
    return unit;
  }

  async findByProperty(user: AuthUser, propertyId: string) {
    await this.propertiesService.findOwned(user, propertyId);
    return this.prisma.unit.findMany({ where: { propertyId }, orderBy: { unitNumber: 'asc' } });
  }

  async findOne(user: AuthUser, id: string) {
    const unit = await this.prisma.unit.findUnique({
      where: { id },
      include: {
        property: true,
        agreements: { orderBy: { createdAt: 'desc' }, take: 5, include: { tenant: { select: { id: true, fullName: true } } } },
      },
    });
    if (!unit) throw new NotFoundException('Unit not found');
    assertCanAccess(user, { ownerId: unit.property.ownerId });
    return unit;
  }

  /** Rent changes apply to future agreements only — existing signed agreements are immutable. */
  async update(user: AuthUser, id: string, dto: UpdateUnitDto) {
    const unit = await this.findOne(user, id);
    if (dto.status && dto.status !== unit.status) assertManualStatusChange(unit.status, dto.status);
    const updated = await this.prisma.unit.update({ where: { id }, data: dto });
    await this.audit.log(AUDIT_ACTIONS.UNIT_UPDATED, 'Unit', id, user, { fields: Object.keys(dto) });
    this.realtime.emitToUsers([unit.property.ownerId], REALTIME_EVENTS.UNIT_UPDATED, updated);
    return updated;
  }

  async remove(user: AuthUser, id: string) {
    await this.findOne(user, id);
    const agreements = await this.prisma.agreement.count({ where: { unitId: id } });
    if (agreements > 0) {
      throw new BadRequestException('Unit has agreement history; unlist it instead of deleting');
    }
    await this.prisma.$transaction([
      this.prisma.rentalRequest.deleteMany({ where: { unitId: id } }),
      this.prisma.unit.delete({ where: { id } }),
    ]);
    await this.audit.log(AUDIT_ACTIONS.UNIT_DELETED, 'Unit', id, user);
    return { deleted: true };
  }
}
