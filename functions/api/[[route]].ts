// Pages Functions: /api/* を Worker(uno-online) へ Service Binding で転送
// DO は Pages Functions から直接バインドできないため、API/WS の実体は Worker 側
export const onRequest = async ({
	request,
	env,
}: {
	request: Request;
	env: { API: Fetcher };
}): Promise<Response> => env.API.fetch(request);
