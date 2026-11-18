import { Injectable } from '@nestjs/common';
import { generateReference } from '../../../common/utils/reference.util';
import { VerifyFaydaDto } from './dto/verify-fayda.dto';

export interface FaydaVerificationResult {
  verified: boolean;
  reference: string;
  verifiedAt: Date;
  reason?: string;
}

@Injectable()
export class FaydaMockService {
  verify(dto: VerifyFaydaDto): FaydaVerificationResult {
    const faydaId = dto.faydaId.trim().toUpperCase();
    const verifiedAt = new Date();
    const reference = generateReference('FMK', verifiedAt);
    if (/(FAIL|INVALID|NO_MATCH)/.test(faydaId)) {
      return {
        verified: false,
        reference,
        verifiedAt,
        reason: 'The mock Fayda provider could not match this ID',
      };
    }
    return { verified: true, reference, verifiedAt };
  }
}
