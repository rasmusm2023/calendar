import { createServer, type Server } from 'node:http'

export const FAKE_GOOGLE_PORT = 9777
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar'

/**
 * LÃ¥tsas-Googles token-endpoint fÃ¶r emulatortester. Koden styr svaret:
 * - `good-code`: lyckas med refresh token `refresh-good`.
 * - `revoked-code`: lyckas med refresh token `refresh-revoked` (som senare Ã¤r Ã¥terkallad).
 * - `no-calendar-code`: lyckas men utan kalenderbehÃ¶righet.
 * - `no-refresh-code`: lyckas utan refresh token.
 * - allt annat: invalid_grant.
 */
export function startFakeGoogle(): Promise<Server> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
      const send = (status: number, body: unknown) => {
        response.writeHead(status, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify(body))
      }

      if (request.method !== 'POST' || request.url !== '/token') {
        send(404, {})
        return
      }
      if (form.get('client_id') !== 'emulator-test-client-id') {
        send(401, { error: 'invalid_client' })
        return
      }

      if (form.get('grant_type') === 'authorization_code') {
        if (form.get('redirect_uri') !== 'postmessage') {
          send(400, { error: 'invalid_request' })
          return
        }
        switch (form.get('code')) {
          case 'good-code': {
            send(200, {
              access_token: 'fake-access-from-code',
              expires_in: 3599,
              refresh_token: 'refresh-good',
              scope: `openid ${CALENDAR_SCOPE}`,
              token_type: 'Bearer',
            })
            return
          }
          case 'revoked-code': {
            send(200, {
              access_token: 'fake-access-from-code',
              expires_in: 3599,
              refresh_token: 'refresh-revoked',
              scope: CALENDAR_SCOPE,
              token_type: 'Bearer',
            })
            return
          }
          case 'no-calendar-code': {
            send(200, {
              access_token: 'fake-access',
              expires_in: 3599,
              refresh_token: 'refresh-good',
              scope: 'openid email',
              token_type: 'Bearer',
            })
            return
          }
          case 'no-refresh-code': {
            send(200, {
              access_token: 'fake-access',
              expires_in: 3599,
              scope: CALENDAR_SCOPE,
              token_type: 'Bearer',
            })
            return
          }
          default: {
            send(400, { error: 'invalid_grant' })
            return
          }
        }
      }

      if (form.get('grant_type') === 'refresh_token') {
        if (form.get('refresh_token') === 'refresh-good') {
          send(200, {
            access_token: 'fake-access-from-refresh',
            expires_in: 3599,
            token_type: 'Bearer',
          })
          return
        }
        send(400, { error: 'invalid_grant' })
        return
      }

      send(400, { error: 'unsupported_grant_type' })
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(FAKE_GOOGLE_PORT, '127.0.0.1', () => {
      resolve(server)
    })
  })
}
