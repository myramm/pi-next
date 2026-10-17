import { webSocketLink } from "./link.js";
/** Accepts every connection of `server` on `host` as a client link stamped with the authenticated principal. */
export function acceptWebSockets(server, host, options) {
    server.on("connection", (socket, request) => {
        // Wrap at once so frames sent while authenticating are queued, not lost. Large payloads go out deflated; clients
        // may not send packed frames (a small message could inflate to anything).
        const link = webSocketLink(socket, { compress: true, acceptPacked: false });
        Promise.resolve(options.principal(request)).then((principal) => {
            if (principal === undefined)
                link.close("unauthorized");
            else
                host.accept(link, { ...options, principal, kind: "client" });
        }, () => link.close("authentication failed"));
    });
}
//# sourceMappingURL=websocket.js.map