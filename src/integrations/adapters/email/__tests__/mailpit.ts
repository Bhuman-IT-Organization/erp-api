/**
 * A thin client of the local Mailpit REST API (ADR-0049 decision 10; erp-infra `compose/local.yml`,
 * host port 18025) for the int specs: clear the inbox, find a message by its Message-ID, read it,
 * and switch the chaos triggers on and off. Reads no `process.env`: the spec passes the base URL
 * (`MAILPIT_API_URL` of the host env). Every call gives up after five seconds.
 */
const REQUEST_TIMEOUT_MS = 5_000;
const PAGE_SIZE = 200;

export interface MailpitMessage {
  readonly From: { readonly Name: string; readonly Address: string };
  readonly HTML: string;
  readonly Text: string;
  readonly Headers?: Record<string, string[]>;
}

export interface Mailpit {
  clear(): Promise<void>;
  findByMessageId(id: string): Promise<{ id: string } | null>;
  message(id: string): Promise<MailpitMessage>;
  /** Mailpit chaos triggers, e.g. `{ Recipient: { ErrorCode: 451, Probability: 100 } }`. */
  chaos(triggers: object): Promise<void>;
  chaosOff(): Promise<void>;
}

/** The Message-ID without its angle brackets, as Mailpit stores it. */
function bare(id: string): string {
  return id.replace(/^</, '').replace(/>$/, '');
}

export function mailpit(baseUrl: string): Mailpit {
  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(new URL(path, baseUrl), {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`mailpit ${path} answered ${String(response.status)}`);
    return response;
  }
  const json = async <T>(path: string): Promise<T> => (await (await call(path)).json()) as T;
  const put = async (path: string, body: object): Promise<void> => {
    await call(path, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  };

  return {
    async clear() {
      await call('/api/v1/messages', { method: 'DELETE' });
    },
    async findByMessageId(id) {
      const list = await json<{ messages: { ID: string; MessageID: string }[] }>(
        `/api/v1/messages?limit=${String(PAGE_SIZE)}`,
      );
      const found = list.messages.find((m) => bare(m.MessageID) === bare(id));
      return found === undefined ? null : { id: found.ID };
    },
    async message(id) {
      const body = await json<Omit<MailpitMessage, 'Headers'>>(`/api/v1/message/${id}`);
      const headers = await json<Record<string, string[]>>(`/api/v1/message/${id}/headers`);
      return { ...body, Headers: headers };
    },
    chaos: (triggers) => put('/api/v1/chaos', triggers),
    chaosOff: () => put('/api/v1/chaos', {}),
  };
}
