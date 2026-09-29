import axios from 'axios';
import { BadRequestException } from '@nestjs/common';
import { mockConfig } from '../../../test-utils/mocks';
import { TelebirrService } from './telebirr.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const LIVE = {
  TELEBIRR_MOCK: 'false',
  TELEBIRR_APP_ID: 'app',
  TELEBIRR_APP_KEY: 'key',
  TELEBIRR_APP_SECRET: 'secret',
  TELEBIRR_MERCH_CODE: 'm',
  TELEBIRR_API_BASE_URL: 'https://tb.test',
  TELEBIRR_WEB_BASE_URL: 'https://web.test/pay',
  TELEBIRR_SHORT_CODE: '123',
};

describe('TelebirrService', () => {
  beforeEach(() => jest.resetAllMocks());

  it('isMock defaults to true; configured requires credentials', () => {
    expect(new TelebirrService(mockConfig()).isMock()).toBe(true);
    expect(new TelebirrService(mockConfig()).configured).toBe(false);
    expect(new TelebirrService(mockConfig(LIVE)).configured).toBe(true);
  });

  it('createPaymentOrder returns a mock checkout in mock mode', async () => {
    const service = new TelebirrService(mockConfig({ BASE_URL: 'http://api' }));
    const result = await service.createPaymentOrder({ orderReference: 'PAY-1', amount: 10, title: 't', notifyUrl: 'n', phone: '+251911223344' });
    expect(result).toMatchObject({ mode: 'mock', paymentUrl: 'http://api/api/v1/payments/telebirr/mock-checkout/PAY-1' });
    expect(result.ussd.phone).toBe('0911223344');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('createPaymentOrder rejects live mode without credentials', async () => {
    const service = new TelebirrService(mockConfig({ TELEBIRR_MOCK: 'false' }));
    await expect(service.createPaymentOrder({ orderReference: 'x', amount: 1, title: 't', notifyUrl: 'n' })).rejects.toThrow(BadRequestException);
  });

  it('createPaymentOrder wraps live API failures', async () => {
    const service = new TelebirrService(mockConfig(LIVE));
    mockedAxios.post.mockResolvedValueOnce({ data: {} });
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    await expect(service.createPaymentOrder({ orderReference: 'x', amount: 1, title: 't', notifyUrl: 'n' })).rejects.toThrow('Telebirr payment initiation failed');
  });

  it('verifyCallback: legacy accepted only in mock mode, USSD accepted, garbage rejected', () => {
    const legacy = JSON.stringify({ merch_order_id: 'PAY-1' });
    expect(new TelebirrService(mockConfig()).verifyCallback(legacy)).toEqual({ ok: true });
    expect(new TelebirrService(mockConfig(LIVE)).verifyCallback(legacy).ok).toBe(false);
    expect(new TelebirrService(mockConfig(LIVE)).verifyCallback('<?xml?><res:OriginatorConversationID>P</res:OriginatorConversationID>')).toEqual({ ok: true });
    expect(new TelebirrService(mockConfig()).verifyCallback('junk').ok).toBe(false);
  });

  it('verifyCallback: H5 envelopes pass in mock mode without keys', () => {
    const body = JSON.stringify({ biz_content: JSON.stringify({ outTradeNo: 'P', resultCode: '0' }), sign: 'x' });
    expect(new TelebirrService(mockConfig()).verifyCallback(Buffer.from(body))).toEqual({ ok: true });
  });

  it('parseCallback delegates to the parser', () => {
    expect(new TelebirrService(mockConfig()).parseCallback(JSON.stringify({ merch_order_id: 'A' })).callback.orderReference).toBe('A');
  });

  it('queryOrder returns pending in mock mode and maps live results', async () => {
    expect(await new TelebirrService(mockConfig()).queryOrder('P')).toEqual({ status: 'pending' });
    const live = new TelebirrService(mockConfig(LIVE));
    (live as any).crypto = { buildBizContent: () => '{}', signPayload: () => 'sig' };
    mockedAxios.post
      .mockResolvedValueOnce({ data: { token: 'tok' } })
      .mockResolvedValueOnce({ data: { data: { resultCode: '0', transId: 'T', totalAmount: '10.00' } } });
    await expect(live.queryOrder('P')).resolves.toEqual({ status: 'completed', transId: 'T', amount: 10 });
  });

  it('normalizePhone converts +251 to local format', () => {
    expect(new TelebirrService(mockConfig()).normalizePhone('+251911223344')).toBe('0911223344');
    expect(new TelebirrService(mockConfig()).normalizePhone('0911223344')).toBe('0911223344');
  });
});
