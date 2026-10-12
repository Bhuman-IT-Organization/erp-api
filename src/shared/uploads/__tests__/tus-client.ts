/**
 * A tiny tus 1.0.0 client over `node:http` for the uploads e2e spec: one request per call, a real
 * socket, never `fetch`. `uploadMetadata` builds `Upload-Metadata` as `key base64(value)` pairs.
 */
import { request } from 'node:http';

/** What one call answers. */
export interface TusAnswer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: string;
}

/** `Upload-Metadata` from a plain record (tus 1.0.0 creation extension). */
export function uploadMetadata(values: Readonly<Record<string, string>>): string {
  return Object.entries(values)
    .map(([key, value]) => `${key} ${Buffer.from(value, 'utf8').toString('base64')}`)
    .join(',');
}

/** One tus request to `127.0.0.1:<port><path>`; `Tus-Resumable: 1.0.0` is always sent. */
export function tusCall(
  port: number,
  method: string,
  path: string,
  headers: Readonly<Record<string, string>> = {},
  body?: Buffer,
): Promise<TusAnswer> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          'Tus-Resumable': '1.0.0',
          ...(body === undefined ? {} : { 'Content-Length': String(body.length) }),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}
