export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly details: unknown,
  ) {
    super(`API request failed with status ${status}`);
    this.name = "ApiError";
  }
}

export type ApiFetcher = <T>(url: string, init: RequestInit) => Promise<T>;

let developmentFetcher: ApiFetcher | undefined;

export function setDevelopmentApiFetcher(fetcher?: ApiFetcher) {
  developmentFetcher = fetcher;
}

export async function apiFetch<T>(
  url: string,
  init: RequestInit,
): Promise<T> {
  if (developmentFetcher) {
    return developmentFetcher<T>(url, init);
  }

  const response = await fetch(`/api${url}`, {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    const details = await response.json().catch(() => null);
    throw new ApiError(response.status, details);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
