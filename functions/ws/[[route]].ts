// Pages Functions: /ws/:code を Worker(uno-online) の GameRoom DO へ転送
// Service Binding は WebSocket upgrade も透過する
export const onRequest = async ({
	request,
	env,
}: {
	request: Request;
	env: { API: Fetcher };
}): Promise<Response> => env.API.fetch(request);
