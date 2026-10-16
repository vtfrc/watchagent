// Temporary, authenticated evaluation harness. Never imported by the production entrypoint.
import { z } from 'zod';
import { classifyChange, shouldEmit } from '../src/evaluation';

interface EvaluationEnv { AI: Ai; AI_MODEL: string; EVAL_KEY?: string }
const inputSchema = z.object({
  condition: z.string().min(3).max(1000), old_page: z.string().max(12000), new_page: z.string().max(12000)
}).strict();
export default {
  async fetch(request: Request, env: EvaluationEnv): Promise<Response> {
    if (!env.EVAL_KEY || request.headers.get('authorization') !== `Bearer ${env.EVAL_KEY}`) return Response.json({ error: 'unauthorized' }, { status: 401 });
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    const started = Date.now();
    try {
      const text = await request.text();
      if (text.length > 30000) return Response.json({ error: 'payload_too_large' }, { status: 413 });
      const body = inputSchema.parse(JSON.parse(text));
      const evaluation = await classifyChange(env, body.condition, body.old_page, body.new_page);
      return Response.json({ evaluation, emitted: shouldEmit(evaluation), latency_ms: Date.now() - started });
    } catch (error) {
      return Response.json({ error: String(error), latency_ms: Date.now() - started }, { status: 502 });
    }
  }
} satisfies ExportedHandler<EvaluationEnv>;
