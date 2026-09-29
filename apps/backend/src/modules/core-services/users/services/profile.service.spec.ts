import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createPrismaMock, mockAudit, mockConfig, USERS } from '../../../../test-utils/mocks';
import { decryptText, encryptText } from '../../../../common/utils/crypto.util';
import { ProfileService, maskIdNumber } from './profile.service';

const KEY = 'test-data-encryption-key';

describe('ProfileService', () => {
  const prisma = createPrismaMock();
  const audit = mockAudit();
  const service = new ProfileService(prisma, audit as any, mockConfig({ DATA_ENCRYPTION_KEY: KEY }));

  beforeEach(() => jest.clearAllMocks());

  it('maskIdNumber keeps only the last 4 characters', () => {
    expect(maskIdNumber('AB123456')).toBe('****3456');
    expect(maskIdNumber('123')).toBe('****');
    expect(maskIdNumber(null)).toBeNull();
  });

  it('buildTenantProfileData encrypts the ID, normalizes phone and flags KYC pending', () => {
    const data: any = service.buildTenantProfileData({ idType: 'KEBELE_ID', idNumber: 'AA-99', emergencyContactPhone: '0911000099', dateOfBirth: '1995-01-01' });
    expect(decryptText(data.idNumberEncrypted, KEY)).toBe('AA-99');
    expect(data).toMatchObject({ idType: 'KEBELE_ID', emergencyContactPhone: '+251911000099', kycStatus: 'PENDING' });
    expect(data.dateOfBirth).toBeInstanceOf(Date);
    expect(service.buildTenantProfileData({ occupation: 'Teacher' })).toEqual({ occupation: 'Teacher' });
    expect(() => service.buildTenantProfileData({ emergencyContactPhone: '123' })).toThrow(BadRequestException);
  });

  it('getProfile masks the decrypted ID number', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'u', passwordHash: 'x', tenantProfile: { idNumberEncrypted: encryptText('ID12345678', KEY) } });
    const result: any = await service.getProfile(USERS.tenant);
    expect(result.tenantProfile.idNumberMasked).toBe('******5678');
    expect(result).not.toHaveProperty('passwordHash');
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(service.getProfile(USERS.tenant)).rejects.toThrow(NotFoundException);
  });

  it('updateMe updates fields and rejects taken emails', async () => {
    prisma.user.findFirst.mockResolvedValueOnce(null);
    prisma.user.update.mockResolvedValueOnce({ id: 'u', language: 'AM' });
    await expect(service.updateMe(USERS.tenant, { email: 'NEW@x.et', language: 'AM' })).resolves.toEqual({ id: 'u', language: 'AM' });
    expect(prisma.user.update.mock.calls[0][0].data).toMatchObject({ email: 'new@x.et', language: 'AM' });
    prisma.user.findFirst.mockResolvedValueOnce({ id: 'other' });
    await expect(service.updateMe(USERS.tenant, { email: 'x@x.et' })).rejects.toThrow(ConflictException);
  });

  it('updateOwnerProfile upserts the profile', async () => {
    prisma.ownerProfile.upsert.mockResolvedValue({ companyName: 'Co' });
    await expect(service.updateOwnerProfile(USERS.owner, { companyName: 'Co' })).resolves.toEqual({ companyName: 'Co' });
    expect(prisma.ownerProfile.upsert.mock.calls[0][0].where).toEqual({ userId: USERS.owner.id });
  });

  it('updateTenantProfile upserts, audits KYC submission and masks the response', async () => {
    prisma.tenantProfile.upsert.mockImplementation(async ({ update }) => ({ id: 'p', ...update }));
    const result: any = await service.updateTenantProfile(USERS.tenant, { idNumber: 'ZZ998877' });
    expect(result.idNumberMasked).toBe('****8877');
    expect(result).not.toHaveProperty('idNumberEncrypted');
    expect(audit.log).toHaveBeenCalledWith('KYC_UPDATED', 'User', USERS.tenant.id, USERS.tenant, { kycStatus: 'PENDING' });
  });
});
