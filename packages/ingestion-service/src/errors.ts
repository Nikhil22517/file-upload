/** A refusal with an HTTP-style status and a detail the caller can show. The Hono API turns it into a
 *  response; the web app's server functions turn it into a message on the screen. */
export class ServiceError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 422, readonly detail: unknown) {
    super(typeof detail === 'string' ? detail : (detail as { message?: string })?.message ?? 'Request refused');
    this.name = 'ServiceError';
  }
}

export const fail = (status: ServiceError['status'], detail: unknown): never => {
  throw new ServiceError(status, detail);
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID.test(v);

/** Postgres unique violation, whether or not drizzle wrapped the driver error. */
export const isUniqueViolation = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === '23505' || err?.cause?.code === '23505';
};
