import { parseTelebirrCallback } from './telebirr-callback.parser';

describe('parseTelebirrCallback', () => {
  it('parses a signed H5 JSON envelope', () => {
    const biz = JSON.stringify({ outTradeNo: 'PAY-1', transId: 'T1', totalAmount: '100.00', resultCode: '0' });
    const result = parseTelebirrCallback(JSON.stringify({ biz_content: biz, sign: 'SIG' }));
    expect(result).toMatchObject({ format: 'h5', signature: 'SIG', signedPayload: biz });
    expect(result.callback).toMatchObject({ orderReference: 'PAY-1', transId: 'T1', amount: 100, success: true });
  });

  it('parses a USSD SOAP callback', () => {
    const xml = '<?xml version="1.0"?><res:OriginatorConversationID>PAY-2</res:OriginatorConversationID><res:TransactionID>T2</res:TransactionID><res:ResultCode>0</res:ResultCode>';
    const result = parseTelebirrCallback(xml);
    expect(result.format).toBe('ussd');
    expect(result.callback).toMatchObject({ orderReference: 'PAY-2', transId: 'T2', success: true });
  });

  it('parses the legacy mock body', () => {
    const result = parseTelebirrCallback(Buffer.from(JSON.stringify({ merch_order_id: 'PAY-3', amount: 50, transId: 'T3' })));
    expect(result.format).toBe('legacy');
    expect(result.callback).toMatchObject({ orderReference: 'PAY-3', amount: 50, transId: 'T3' });
  });

  it('returns unknown for empty or unparseable bodies', () => {
    expect(parseTelebirrCallback('').callback).toBeNull();
    expect(parseTelebirrCallback('not json').format).toBe('unknown');
    expect(parseTelebirrCallback('{"foo":1}').format).toBe('unknown');
    expect(parseTelebirrCallback('<?xml?><x/>').callback).toBeNull();
  });
});
