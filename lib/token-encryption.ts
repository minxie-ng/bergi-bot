import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const ENCRYPTION_PREFIX = 'v1'

export class TokenEncryptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TokenEncryptionError'
  }
}

function getEncryptionKey(): Buffer {
  const rawKey = process.env.TOKEN_ENCRYPTION_KEY?.trim()

  if (!rawKey) {
    throw new TokenEncryptionError('missing_token_encryption_key')
  }

  return createHash('sha256').update(rawKey).digest()
}

export function hasTokenEncryptionKey(): boolean {
  return Boolean(process.env.TOKEN_ENCRYPTION_KEY?.trim())
}

export function encryptToken(plainText: string): string {
  const key = getEncryptionKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const cipherText = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [ENCRYPTION_PREFIX, iv.toString('base64url'), authTag.toString('base64url'), cipherText.toString('base64url')].join(
    ':'
  )
}

export function decryptToken(encryptedToken: string): string {
  const [version, ivBase64, authTagBase64, cipherTextBase64] = encryptedToken.split(':')

  if (version !== ENCRYPTION_PREFIX || !ivBase64 || !authTagBase64 || !cipherTextBase64) {
    throw new TokenEncryptionError('invalid_encrypted_token')
  }

  const key = getEncryptionKey()
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivBase64, 'base64url'))
  decipher.setAuthTag(Buffer.from(authTagBase64, 'base64url'))
  const plainText = Buffer.concat([
    decipher.update(Buffer.from(cipherTextBase64, 'base64url')),
    decipher.final(),
  ]).toString('utf8')

  return plainText
}

export function signValue(value: string): string {
  const key = getEncryptionKey()
  return createHmac('sha256', key).update(value).digest('base64url')
}

export function signaturesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}
