import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface TestServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

/** Spin up a throwaway HTTP server on a random free port. */
export async function startTestServer(
  handler: http.RequestListener,
): Promise<TestServer> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    close: () => new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    ),
  };
}

export async function fetchText(url: string): Promise<{ status: number; body: string; headers: Headers }> {
  const response = await fetch(url);
  return { status: response.status, body: await response.text(), headers: response.headers };
}
