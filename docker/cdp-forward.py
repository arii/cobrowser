"""TCP forwarder: 0.0.0.0:9223 -> 127.0.0.1:9222 inside the Chromium container.

Modern Chromium ignores --remote-debugging-address and binds its DevTools
server to container loopback only. This forwarder re-exposes it on all
interfaces (protocol-agnostic: plain HTTP and websocket upgrades alike).
Runs daemon-side via `docker exec -d`; logs to /tmp/cdp-forward.log.
"""

import socket
import threading

LISTEN = ("0.0.0.0", 9223)
TARGET = ("127.0.0.1", 9222)


def pipe(a: socket.socket, b: socket.socket) -> None:
    try:
        while True:
            data = a.recv(65536)
            if not data:
                break
            b.sendall(data)
    except OSError:
        pass
    for s in (a, b):
        try:
            s.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass


def handle(client: socket.socket) -> None:
    try:
        upstream = socket.create_connection(TARGET, timeout=10)
    except OSError:
        client.close()
        return
    threading.Thread(target=pipe, args=(client, upstream), daemon=True).start()
    pipe(upstream, client)
    client.close()
    upstream.close()


def main() -> None:
    listener = socket.create_server(LISTEN, reuse_port=True)
    print("cdp-forward listening on 0.0.0.0:9223", flush=True)
    while True:
        client, _ = listener.accept()
        threading.Thread(target=handle, args=(client,), daemon=True).start()


if __name__ == "__main__":
    main()
