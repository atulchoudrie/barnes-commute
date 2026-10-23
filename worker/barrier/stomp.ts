// Minimal STOMP 1.2 client over TCP for Network Rail's open data feeds (no dependencies).
// Reconnects with backoff, and if the feed goes quiet for a minute.
import net from "node:net";

export interface StompOptions {
  host: string;
  port: number;
  login: string;
  passcode: string;
  destination: string;
  onMessage: (body: string) => void;
  onState: (state: "connecting" | "connected" | "disconnected", detail?: string) => void;
}

const HEARTBEAT_MS = 15_000;
const SILENCE_MS = 60_000;

export function runStomp(o: StompOptions): void {
  let backoff = 1000;

  const connect = () => {
    o.onState("connecting");
    const sock = net.connect(o.port, o.host);
    let buf = "", lastData = Date.now();
    const frame = (command: string, headers: Record<string, string>) =>
      sock.write(`${command}\n${Object.entries(headers).map(([k, v]) => `${k}:${v}`).join("\n")}\n\n\0`);
    const timer = setInterval(() => {
      if (Date.now() - lastData > SILENCE_MS) sock.destroy(new Error("feed went quiet"));
      else sock.write("\n");
    }, HEARTBEAT_MS);

    sock.setEncoding("utf8");
    sock.on("connect", () => frame("CONNECT", {
      "accept-version": "1.2", host: "/", login: o.login, passcode: o.passcode, "heart-beat": `${HEARTBEAT_MS},${HEARTBEAT_MS}`,
    }));
    sock.on("data", (chunk: string) => {
      lastData = Date.now();
      buf += chunk;
      let end: number;
      while ((end = buf.indexOf("\0")) >= 0) {
        const raw = buf.slice(0, end).replace(/^[\r\n]+/, "");
        buf = buf.slice(end + 1);
        const split = raw.indexOf("\n\n");
        const head = (split >= 0 ? raw.slice(0, split) : raw).split("\n");
        const body = split >= 0 ? raw.slice(split + 2) : "";
        const command = head[0].trim();
        if (command === "CONNECTED") {
          backoff = 1000;
          o.onState("connected");
          frame("SUBSCRIBE", { id: "1", destination: o.destination, ack: "auto" });
        } else if (command === "MESSAGE") {
          o.onMessage(body);
        } else if (command === "ERROR") {
          const msg = head.find((h) => h.startsWith("message:"))?.slice(8) ?? body.slice(0, 200);
          sock.destroy(new Error(msg));
        }
      }
      if (buf.length > 5_000_000) buf = ""; // never let a broken frame grow without limit
    });
    sock.on("error", () => {}); // reported on close
    sock.on("close", (hadError) => {
      clearInterval(timer);
      o.onState("disconnected", hadError ? "connection error" : "closed");
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 60_000);
    });
  };

  connect();
}
