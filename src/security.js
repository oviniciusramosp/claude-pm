import crypto from 'node:crypto';

function safeEquals(a, b) {
  const aBuffer = Buffer.from(a, 'utf8');
  const bBuffer = Buffer.from(b, 'utf8');

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

export function validateNotionSignature(rawBody, signature, secret) {
  if (!secret) {
    return true;
  }

  if (!signature) {
    return false;
  }

  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  return safeEquals(expected, signature);
}
