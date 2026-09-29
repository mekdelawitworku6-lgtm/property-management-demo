import axios from 'axios';
import { mockConfig } from '../../../test-utils/mocks';
import { TelegramService } from './telegram.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('TelegramService', () => {
  beforeEach(() => jest.resetAllMocks());

  it('isEnabled requires a bot token', () => {
    expect(new TelegramService(mockConfig()).isEnabled()).toBe(false);
    expect(new TelegramService(mockConfig({ TELEGRAM_BOT_TOKEN: 't' })).isEnabled()).toBe(true);
  });

  it('send is a no-op when disabled', async () => {
    await expect(new TelegramService(mockConfig()).send('1', 'x')).resolves.toBe(false);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('send posts to the Bot API and swallows errors', async () => {
    const service = new TelegramService(mockConfig({ TELEGRAM_BOT_TOKEN: 'tok' }));
    mockedAxios.post.mockResolvedValueOnce({});
    await expect(service.send('42', 'hello')).resolves.toBe(true);
    expect(mockedAxios.post).toHaveBeenCalledWith('https://api.telegram.org/bottok/sendMessage', { chat_id: '42', text: 'hello' }, expect.anything());
    mockedAxios.post.mockRejectedValueOnce(new Error('x'));
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    await expect(service.send('42', 'hello')).resolves.toBe(false);
  });
});
