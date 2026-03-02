import type { RouteMethod } from '../connect/services/legacyRouteProxyTypes.js';

type BinaryParser = (
  response: unknown,
  callback: (error: Error | null, body: Buffer) => void
) => void;

type CompatResponse = {
  status: number;
  body: unknown;
  headers: Record<string, string>;
  text: string;
};

class CompatRequestBuilder implements PromiseLike<CompatResponse> {
  private readonly headers = new Headers();
  private readonly queryParams = new URLSearchParams();
  private payload: unknown = undefined;
  private binaryParser: BinaryParser | null = null;

  constructor(
    private readonly method: RouteMethod,
    private readonly rawPath: string
  ) {}

  set(name: string, value: string): this {
    this.headers.set(name, value);
    return this;
  }

  send(body: unknown): this {
    this.payload = body;
    return this;
  }

  query(params: Record<string, string | number | boolean>): this {
    for (const [key, value] of Object.entries(params)) {
      this.queryParams.set(key, String(value));
    }
    return this;
  }

  buffer(_enabled: boolean): this {
    return this;
  }

  parse(parser: BinaryParser): this {
    this.binaryParser = parser;
    return this;
  }

  then<TResult1 = CompatResponse, TResult2 = never>(
    onfulfilled?:
      | ((value: CompatResponse) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<CompatResponse> {
    const { executeRoute } = await import(
      '../connect/services/legacyRouteProxyExecution.js'
    );
    const pathUrl = new URL(this.rawPath, 'http://localhost');
    for (const [key, value] of pathUrl.searchParams.entries()) {
      this.queryParams.append(key, value);
    }

    const routePath = normalizeRoutePath(pathUrl.pathname);
    const contentType = this.headers.get('content-type')?.toLowerCase() ?? '';
    const isJsonBody = contentType.includes('application/json');

    let jsonBody: string | undefined;
    if (this.payload === undefined) {
      jsonBody = undefined;
    } else if (typeof this.payload === 'string') {
      jsonBody = isJsonBody ? this.payload : undefined;
    } else if (this.payload instanceof Uint8Array || Buffer.isBuffer(this.payload)) {
      jsonBody = undefined;
    } else {
      jsonBody = JSON.stringify(this.payload);
    }

    const result = await executeRoute({
      context: { requestHeader: this.headers },
      method: this.method,
      path: routePath,
      query: this.queryParams,
      ...(jsonBody !== undefined ? { jsonBody } : {})
    });

    const headers: Record<string, string> = {};
    if (result.contentType) {
      headers['content-type'] = result.contentType;
    }

    if (result.body instanceof Uint8Array) {
      const buffer = Buffer.from(result.body);
      return {
        status: result.status,
        body: this.binaryParser ? parseBinaryBody(this.binaryParser, buffer) : buffer,
        headers,
        text: buffer.toString('utf8')
      };
    }

    if (typeof result.body === 'string') {
      return {
        status: result.status,
        body: parseJsonIfPossible(result.body),
        headers,
        text: result.body
      };
    }

    if (result.body === undefined || result.body === null) {
      return {
        status: result.status,
        body: {},
        headers,
        text: ''
      };
    }

    return {
      status: result.status,
      body: result.body,
      headers,
      text: JSON.stringify(result.body)
    };
  }
}

class CompatRequester {
  get(path: string): CompatRequestBuilder {
    return new CompatRequestBuilder('GET', path);
  }

  post(path: string): CompatRequestBuilder {
    return new CompatRequestBuilder('POST', path);
  }

  put(path: string): CompatRequestBuilder {
    return new CompatRequestBuilder('PUT', path);
  }

  patch(path: string): CompatRequestBuilder {
    return new CompatRequestBuilder('PATCH', path);
  }

  delete(path: string): CompatRequestBuilder {
    return new CompatRequestBuilder('DELETE', path);
  }
}

function normalizeRoutePath(pathname: string): string {
  if (pathname === '/v1') {
    return '/';
  }
  if (pathname.startsWith('/v1/')) {
    return pathname.slice(3);
  }
  return pathname;
}

function parseJsonIfPossible(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseBinaryBody(parser: BinaryParser, buffer: Buffer): Buffer {
  let parsed = buffer;
  parser(
    {
      on(event: 'data' | 'end', listener: (chunk?: Buffer) => void) {
        if (event === 'data') {
          listener(buffer);
          return;
        }
        listener();
      }
    },
    (error, body) => {
      if (!error) {
        parsed = body;
      }
    }
  );
  return parsed;
}

export default function request(_app: unknown): CompatRequester {
  return new CompatRequester();
}
