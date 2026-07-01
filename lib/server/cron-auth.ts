export function isCronAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    throw new Error('Missing CRON_SECRET')
  }

  const authorization = request.headers.get('authorization')
  const bearerToken = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null
  const querySecret = new URL(request.url).searchParams.get('secret')

  return bearerToken === cronSecret || querySecret === cronSecret
}
