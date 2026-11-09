interface Env {
  BACKEND_URL?: string;
}

interface EventContext<Env, P extends string, Data> {
  request: Request;
  functionPath: string;
  waitUntil: (promise: Promise<unknown>) => void;
  next: (input?: Request | string, init?: RequestInit) => Promise<Response>;
  env: Env;
  params: Record<P, string | string[]>;
  data: Data;
}

type PagesFunction<
  Env = unknown,
  P extends string = string,
  Data extends Record<string, unknown> = Record<string, unknown>
> = (context: EventContext<Env, P, Data>) => Response | Promise<Response>;

export const onRequest: PagesFunction<Env> = async (context) => {
  const req = context.request;

  // Handle preflight OPTIONS requests directly at the edge
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': req.headers.get('Origin') || '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
        'Access-Control-Allow-Headers':
          req.headers.get('Access-Control-Request-Headers') ||
          'Content-Type, Authorization, x-steward-role',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  // Resolve target backend URL from environment variable or default
  const backendBase = (
    context.env.BACKEND_URL || 'https://steward-api.onrender.com'
  ).replace(/\/+$/, '');
  const incomingUrl = new URL(req.url);
  const targetUrl = `${backendBase}${incomingUrl.pathname}${incomingUrl.search}`;

  // Clone headers and preserve forwarding metadata
  const forwardHeaders = new Headers(req.headers);
  try {
    const backendHost = new URL(backendBase).host;
    forwardHeaders.set('host', backendHost);
  } catch {
    // Retain incoming host if parsing fails
  }
  forwardHeaders.set('x-forwarded-host', incomingUrl.host);
  forwardHeaders.set('x-forwarded-proto', incomingUrl.protocol.replace(':', ''));

  // Request body: GET and HEAD cannot send a body in fetch
  const isBodyAllowed = !['GET', 'HEAD'].includes(req.method.toUpperCase());
  const body = isBodyAllowed ? req.body : undefined;

  try {
    const backendResponse = await fetch(targetUrl, {
      method: req.method,
      headers: forwardHeaders,
      body,
      redirect: 'manual',
    });

    // Copy backend response headers and attach CORS headers if missing
    const responseHeaders = new Headers(backendResponse.headers);
    if (!responseHeaders.has('Access-Control-Allow-Origin')) {
      responseHeaders.set(
        'Access-Control-Allow-Origin',
        req.headers.get('Origin') || '*'
      );
    }

    return new Response(backendResponse.body, {
      status: backendResponse.status,
      statusText: backendResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: 'Backend proxy failure',
        message:
          'The STEWARD backend service on Render is unreachable or waking from cold start. Please retry in 15 seconds.',
        target: targetUrl,
        details: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
};
