import Constants from 'expo-constants';

// EXPO_PUBLIC_API_URL is inlined at build time (Railway web preview, EAS builds); app.json extra is the local default.
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  'http://localhost:3000';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

let token: string | null = null;
export const getApiToken = () => token;
export const setApiToken = (t: string | null) => {
  token = t;
};

export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    details?: unknown;
  };
  if (!res.ok)
    throw new ApiError(
      res.status,
      json.error ?? 'error',
      json.message ?? 'Something went wrong',
      json.details,
    );
  return json as T;
}
