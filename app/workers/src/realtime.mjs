export class CampaignRealtimeHub {
  constructor(state) {
    this.state = state;
    this.connections = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.headers.get("upgrade") === "websocket") {
      const ticket = url.searchParams.get("ticket");
      if (!ticket) {
        return new Response(JSON.stringify({ error: "Unauthorized: ticket required" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }

      // Look up and immediately delete the ticket (one-time use).
      const ticketData = await this.state.storage.get(ticket);
      if (!ticketData) {
        return new Response(JSON.stringify({ error: "Unauthorized: invalid or already-used ticket" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
      await this.state.storage.delete(ticket);

      // Reject expired tickets.
      if (Date.now() > ticketData.expiresAt) {
        return new Response(JSON.stringify({ error: "Unauthorized: ticket has expired" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      const clientId = url.searchParams.get("clientId") ?? crypto.randomUUID();
      const sessionId = url.searchParams.get("sessionId") ?? "";

      server.accept();
      this.connections.set(clientId, { socket: server, sessionId, payload: ticketData.payload });

      server.addEventListener("close", () => {
        this.connections.delete(clientId);
      });
      server.addEventListener("error", () => {
        this.connections.delete(clientId);
      });

      server.send(JSON.stringify({ type: "joined" }));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (request.method === "POST" && url.pathname.endsWith("/store-ticket")) {
      const ticketData = await request.json();
      await this.state.storage.put(ticketData.ticket, ticketData);
      return new Response(null, { status: 204 });
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
