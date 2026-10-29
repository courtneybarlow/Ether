// POST /api/brain  { messages, tools?, json? }  →  Claude's response (the app runs any tools and calls again).
import { handle, send, body, requireUser, HttpError } from '../lib/core.js';
import { claude } from '../lib/claude.js';

export default handle(async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'method');
  await requireUser(req);
  const b = body(req);
  if (!Array.isArray(b.messages) || !b.messages.length) throw new HttpError(400, 'no_messages');
  const tools = (Array.isArray(b.tools) ? b.tools : []).slice(0, 12).map(t => ({ name: String(t.name), description: String(t.description || ''), input_schema: t.input_schema || { type: 'object', properties: {} } }));
  const system = 'You are Ether, Courtney’s personal assistant: warm, sharp, and brief, like a great chief of staff. Follow the instructions in her context message exactly.' +
    (b.json !== false ? ' When you give your final answer, output ONLY the JSON object described in the instructions: no prose before or after, no code fences.' : '');
  const out = await claude({ system, messages: b.messages, tools, max_tokens: 2048 });
  send(res, 200, { stop_reason: out.stop_reason, content: out.content });
});
