import axios from 'axios';
import { mockConfig } from '../../../test-utils/mocks';
import { SmsService } from './sms.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('SmsService', () => {
  beforeEach(() => jest.resetAllMocks());

  it('isMock when SMS_MOCK is true or no API URL', () => {
    expect(new SmsService(mockConfig()).isMock()).toBe(true);
    expect(new SmsService(mockConfig({ SMS_MOCK: 'false' })).isMock()).toBe(true);
    expect(new SmsService(mockConfig({ SMS_MOCK: 'false', SMS_API_URL: 'http://sms' })).isMock()).toBe(false);
  });

  it('send logs in mock mode and rejects empty input', async () => {
    const service = new SmsService(mockConfig());
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    await expect(service.send('+251911223344', 'hi')).resolves.toBe(true);
    await expect(service.send('', 'hi')).resolves.toBe(false);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('send posts to the gateway and returns false on failure', async () => {
    const service = new SmsService(mockConfig({ SMS_MOCK: 'false', SMS_API_URL: 'http://sms', SMS_API_KEY: 'k' }));
    mockedAxios.post.mockResolvedValueOnce({ data: {} });
    await expect(service.send('+251911223344', 'hi')).resolves.toBe(true);
    expect(mockedAxios.post).toHaveBeenCalledWith('http://sms', expect.objectContaining({ phone: '+251911223344', msg: 'hi' }), expect.anything());
    mockedAxios.post.mockRejectedValueOnce(new Error('down'));
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    await expect(service.send('+251911223344', 'hi')).resolves.toBe(false);
  });
});
