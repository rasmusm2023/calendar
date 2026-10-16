// Låtsas-Googles token-endpoint för E2E. Functions-emulatorn pekar hit via
// functions/.env.demo-spaces-calendar (GOOGLE_OAUTH_TOKEN_URL). Testerna styr den via /__control/*.
import { createServer } from 'node:http'

const PORT = 9778
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar'
const CLIENT_ID = 'e2e-client-id'
const GOOD_CODE = 'e2e-code'
const REFRESH_TOKEN = 'refresh-e2e'

let revoked = false
let issued = 0

function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

const server = createServer((request, response) => {
  const chunks = []
  request.on('data', (chunk) => chunks.push(chunk))
  request.on('end', () => {
    const url = request.url ?? ''

    if (request.method === 'GET' && url === '/health') {
      send(response, 200, { ok: true })
      return
    }
    if (request.method === 'POST' && url === '/__control/revoke') {
      revoked = true
      send(response, 200, { revoked })
      return
    }
    // Återställ: åtkomsten fungerar igen och en ny koppling (ny kod) accepteras.
    if (request.method === 'POST' && (url === '/__control/restore' || url === '/__control/reset')) {
      revoked = false
      send(response, 200, { revoked })
      return
    }

    if (request.method !== 'POST' || url !== '/token') {
      send(response, 404, {})
      return
    }

    const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
    if (form.get('client_id') !== CLIENT_ID) {
      send(response, 401, { error: 'invalid_client' })
      return
    }

    const grant = form.get('grant_type')
    if (grant === 'authorization_code') {
      if (form.get('redirect_uri') !== 'postmessage' || form.get('code') !== GOOD_CODE) {
        send(response, 400, { error: 'invalid_grant' })
        return
      }
      // En ny koppling ger en ny, fungerande åtkomst.
      revoked = false
      issued += 1
      send(response, 200, {
        access_token: `e2e-access-${String(issued)}`,
        expires_in: 3599,
        refresh_token: REFRESH_TOKEN,
        scope: `openid ${CALENDAR_SCOPE}`,
        token_type: 'Bearer',
      })
      return
    }

    if (grant === 'refresh_token') {
      if (revoked || form.get('refresh_token') !== REFRESH_TOKEN) {
        send(response, 400, { error: 'invalid_grant' })
        return
      }
      issued += 1
      send(response, 200, {
        access_token: `e2e-access-${String(issued)}`,
        expires_in: 3599,
        token_type: 'Bearer',
      })
      return
    }

    send(response, 400, { error: 'unsupported_grant_type' })
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Låtsas-Google lyssnar på http://127.0.0.1:${String(PORT)}`)
})
