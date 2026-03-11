export class CampaignRealtimeHub {
  constructor(state) {
    this.state = state;
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

      // Attach per-connection metadata before handing off to the hibernatable API.
      // serializeAttachment must be called before acceptWebSocket.
      server.serializeAttachment({ clientId, sessionId, payload: ticketData.payload });

      // acceptWebSocket registers the socket with the runtime so it survives DO hibernation.
      // Do NOT call server.accept() — they are mutually exclusive.
      this.state.acceptWebSocket(server);

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
      // getWebSockets() returns all live sockets managed by the hibernatable API,
      // including those that were connected before the DO was last evicted.
      for (const ws of this.state.getWebSockets()) {
        try {
          const { sessionId } = ws.deserializeAttachment();
          // Send to everyone unless both sides have a sessionId that doesn't match,
          // except "refresh" messages always fan out to all connections.
          if (
            !payload.sessionId ||
            !sessionId ||
            payload.sessionId === sessionId ||
            payload.type === "refresh"
          ) {
            ws.send(encoded);
          }
        } catch {
          // Socket may be in a closing/closed state; skip it silently.
        }
      }
      return new Response(null, { status: 204 });
    }

    return new Response("Not found", { status: 404 });
  }

  // Called by the runtime when a message arrives after hibernation wake.
  // No client-to-server messages are currently defined; ignore silently.
  webSocketMessage(_ws, _message) {}

  // Called by the runtime when a client closes the connection.
  // Hibernation cleans up the socket automatically; nothing to do here.
  webSocketClose(_ws, _code, _reason) {}

  // Called by the runtime when the socket encounters an error.
  webSocketError(_ws, error) {
    console.error("WebSocket error:", error);
  }
}
