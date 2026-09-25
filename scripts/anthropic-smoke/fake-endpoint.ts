// Fake Anthropic Messages endpoint for the anthropic-kind provider smoke.
// Serves POST /v1/messages with a canned SSE stream; records each request's
// model + x-api-key to smoke-request.json so the smoke script can assert on
// wire format, provider-scoped key, and bare model id.
import { writeFileSync } from 'fs'
import { createServer } from 'http'

const port = Number(process.env.FAKE_ANTHROPIC_PORT ?? '3771')
const out = process.env.FAKE_ANTHROPIC_RECORD ?? 'smoke-request.json'

const sse =
  'event: message_start\n' +
  `data: ${JSON.stringify({
    type: 'message_start',
    message: {
      id: 'msg_smoke',
      type: 'message',
      role: 'assistant',
      model: 'claude-x',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 1 },
    },
  })}\n\n` +
  'event: content_block_start\n' +
  `data: ${JSON.stringify({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  })}\n\n` +
  'event: content_block_delta\n' +
  `data: ${JSON.stringify({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'pong-42' },
  })}\n\n` +
  'event: content_block_stop\n' +
  `data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n` +
  'event: message_delta\n' +
  `data: ${JSON.stringify({
    type: 'message_delta',
    delta: { stop_reason: 'end_turn' },
    usage: { output_tokens: 5 },
  })}\n\n` +
  'event: message_stop\n' +
  createServer((req, res) => {
    console.log(`REQ ${req.method} ${req.url}`)
    if (req.method === 'POST' && req.url?.split('?')[0] === '/v1/messages') {
      let body = ''
      req.on('data', chunk => (body += chunk))
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}')
        writeFileSync(
          out,
          JSON.stringify({
            url: req.url,
            model: parsed.model,
            apiKey: req.headers['x-api-key'],
            auth: req.headers['authorization'],
          }),
        )
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.end(sse)
      })
      return
    }
    res.writeHead(404)
    res.end('not found')
  }).listen(port, () => {
    console.log(`fake-anthropic listening on ${port}`)
  })
