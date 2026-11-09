export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const badRequest = (code: string, msg: string, details?: unknown) =>
  new HttpError(400, code, msg, details);
export const notFound = (what: string) => new HttpError(404, 'not_found', `${what} not found`);
export const conflict = (code: string, msg: string) => new HttpError(409, code, msg);
export const forbidden = (code: string, msg: string) => new HttpError(403, code, msg);
