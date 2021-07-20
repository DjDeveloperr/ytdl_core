export async function request(
  url: string,
  options?: RequestInit,
): Promise<Response> {
  const res = await fetch(url, options);
  if (res.status >= 400 && res.status < 600) {
    await res.arrayBuffer(); // use the body to prevent leak
    throw new Error(
      `Request to ${url} Failed: ${res.status} ${res.statusText}`,
    );
  }
  return res;
}
