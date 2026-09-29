import * as bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!plain || !hash) return Promise.resolve(false);
  return bcrypt.compare(plain, hash);
}

/** At least 8 chars, one letter and one digit. */
export function isStrongPassword(password: string): boolean {
  return typeof password === 'string' && password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
}
