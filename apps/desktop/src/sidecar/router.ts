// Minimal URL-pattern router for the Bun sidecar.
// Handlers are thin: parse → delegate to service → return. No logic here.

type Params = Record<string, string>;
type Handler = (req: Request, params: Params) => Promise<Response>;

interface Route {
  method: string;
  pattern: URLPattern;
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  get(path: string, handler: Handler): this {
    return this.add('GET', path, handler);
  }
  post(path: string, handler: Handler): this {
    return this.add('POST', path, handler);
  }
  patch(path: string, handler: Handler): this {
    return this.add('PATCH', path, handler);
  }
  delete(path: string, handler: Handler): this {
    return this.add('DELETE', path, handler);
  }

  private add(method: string, path: string, handler: Handler): this {
    this.routes.push({
      method,
      pattern: new URLPattern({ pathname: path }),
      handler,
    });
    return this;
  }

  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      const match = route.pattern.exec(url);
      if (match) {
        const params = (match.pathname.groups ?? {}) as Params;
        try {
          return await route.handler(req, params);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return json({ error: message }, 500);
        }
      }
    }
    return json({ error: 'not found' }, 404);
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function ok(): Response {
  return json({ ok: true });
}
