export class CampaignRealtimeHub {
  constructor(state) {
    this.state = state;
    this.connections = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.headers.get("upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      const clientId = url.searchParams.get("clientId") ?? crypto.randomUUID();
      const sessionId = url.searchParams.get("sessionId") ?? "";

      server.accept();
      this.connections.set(clientId, { socket: server, sessionId });

      server.addEventListener("close", () => {
        this.connections.delete(clientId);
      });
      server.addEventListener("error", () => {
        this.connections.delete(clientId);
      });

      server.send(JSON.stringify({ type: "joined" }));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (request.method === "POST" && url.pathname.endsWith("/broadcast")) {
      const payload = await request.json();
      const encoded = JSON.stringify(payload);
      for (const [clientId, connection] of this.connections) {
        try {
          if (!payload.sessionId || !connection.sessionId || payload.sessionId === connection.sessionId) {
            connection.socket.send(encoded);
          } else if (payload.type === "refresh") {
            connection.socket.send(encoded);
          }
        } catch {
          this.connections.delete(clientId);
        }
      }
      return new Response(null, { status: 204 });
    }

    return new Response("Not found", { status: 404 });
  }
}
