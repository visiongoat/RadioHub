import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import type { WebSocket } from "ws";
import { getPostgresPool } from "../postgres-runtime";
export const roomId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{24}$/.test(value);
export const ticketHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function roomText(value: unknown): string {
  if (typeof value !== "string")
    throw Object.assign(Error("INVALID_MESSAGE"), { status: 400 });
  const text = value
    .normalize("NFC")
    .replace(/[\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .trim();
  if (!text || !/[\p{L}\p{N}\p{P}\p{S}]/u.test(text) || [...text].length > 400)
    throw Object.assign(Error("INVALID_MESSAGE"), { status: 400 });
  if (/https?:\/\/|www\.|(?:t\.me|wa\.me|bit\.ly)\//i.test(text))
    throw Object.assign(Error("LINK_NOT_ALLOWED"), { status: 400 });
  // First release deterministic abuse floor. Never claim this catches all abuse;
  // reporting and server sanctions remain necessary and operate independently.
  const words = text
    .toLocaleLowerCase("en")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i");
  if (
    /(?:^|[^\p{L}\p{N}])(?:orospu|siktir|sikeyim|amk|fuck|fucking|cunt|hurensohn|fotze)(?:$|[^\p{L}\p{N}])/u.test(
      words,
    )
  )
    throw Object.assign(Error("MESSAGE_NOT_ALLOWED"), { status: 400 });
  return text;
}
export function roomContent(body: any) {
  const messageType = body?.messageType ?? "text";
  if (!["text", "gif"].includes(messageType))
    throw Object.assign(Error("INVALID_MESSAGE"), { status: 400 });
  const content = roomText(body?.content);
  if (messageType === "gif" && !/^klipy:[a-zA-Z0-9_-]{1,200}$/.test(content))
    throw Object.assign(Error("INVALID_MESSAGE"), { status: 400 });
  return { content, messageType };
}
export const messageSQL = `SELECT m.id AS "_id",m.station_id AS "stationId",m.user_id AS "userId",m.content,m.message_type AS "messageType",m.created_at AS "createdAt",m.deleted_at AS "deletedAt",jsonb_build_object('_id',u.id,'fullName',u.full_name,'username',u.username,'avatar',u.avatar,'profileImageUrl',u.source->>'profileImageUrl','canOpenProfile',u.is_public_profile) AS sender FROM station_chat_messages m JOIN users u ON u.id=m.user_id`;
export async function roomPage(
  station: string,
  actor: string,
  before?: string,
) {
  const db = getPostgresPool();
  const rows = (
    await db.query(
      `${messageSQL} WHERE m.station_id=$1 AND m.created_at>now()-interval '24 hours' AND m.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM station_chat_blocks b WHERE b.user_id=$2 AND b.blocked_user_id=m.user_id) AND ($3='' OR (m.created_at,m.id)<(SELECT created_at,id FROM station_chat_messages WHERE id=$3 AND station_id=$1)) ORDER BY m.created_at DESC,m.id DESC LIMIT 51`,
      [station, actor, before || ""],
    )
  ).rows;
  return { messages: rows.slice(0, 50).reverse(), hasMore: rows.length > 50 };
}
export async function sendRoomMessage(
  station: string,
  actor: string,
  body: any,
) {
  const { content, messageType } = roomContent(body),
    clientId = body?.clientId;
  if (
    typeof clientId !== "string" ||
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(clientId)
  )
    throw Object.assign(Error("INVALID_MESSAGE"), { status: 400 });
  const db = await getPostgresPool().connect();
  try {
    await db.query("BEGIN");
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('station-chat-send:'||$1,0))",
      [actor],
    );
    const duplicate = (
      await db.query(messageSQL + " WHERE m.user_id=$1 AND m.client_id=$2", [
        actor,
        clientId,
      ])
    ).rows[0];
    if (duplicate) {
      if (
        duplicate.stationId !== station ||
        duplicate.content !== content ||
        duplicate.messageType !== messageType
      )
        throw Object.assign(Error("INVALID_MESSAGE"), { status: 400 });
      await db.query("COMMIT");
      return duplicate;
    }
    const allowed = (
      await db.query(
        `SELECT 1 WHERE EXISTS(SELECT 1 FROM station_chat_sessions WHERE user_id=$1 AND station_id=$2 AND connected AND expires_at>now()) AND NOT EXISTS(SELECT 1 FROM station_chat_sanctions WHERE user_id=$1 AND expires_at>now())`,
        [actor, station],
      )
    ).rowCount;
    if (!allowed)
      throw Object.assign(Error("CHAT_WRITE_UNAVAILABLE"), { status: 403 });
    const rate = (
      await db.query(
        `SELECT count(*)::int AS count,COALESCE(max(created_at)>now()-interval '3 seconds',false) AS fast,COALESCE(bool_or(content=$2),false) AS duplicate FROM station_chat_messages WHERE user_id=$1 AND created_at>now()-interval '1 minute'`,
        [actor, content],
      )
    ).rows[0];
    if (rate.count >= 20 || rate.fast || rate.duplicate)
      throw Object.assign(Error("SLOW_DOWN"), { status: 429 });
    const id = randomBytes(12).toString("hex");
    await db.query(
      "INSERT INTO station_chat_messages(id,station_id,user_id,client_id,content,message_type) VALUES($1,$2,$3,$4,$5,$6)",
      [id, station, actor, clientId, content, messageType],
    );
    const message = (await db.query(messageSQL + " WHERE m.id=$1", [id]))
      .rows[0];
    await db.query(
      `DELETE FROM station_chat_messages WHERE id IN (SELECT id FROM station_chat_messages WHERE station_id=$1 ORDER BY created_at DESC,id DESC OFFSET 200 LIMIT 100)`,
      [station],
    );
    await notifyRoom(db, station, { type: "message", message });
    await db.query("COMMIT");
    return message;
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}
export async function notifyRoom(
  db: { query: Function },
  stationId: string,
  event: object,
) {
  // PostgreSQL notifications only carry bounded invalidations, not message text.
  await db.query("SELECT pg_notify('mega_station_chat',$1)", [
    JSON.stringify({
      stationId,
      event:
        "message" in event
          ? { type: "changed", messageId: (event as any).message._id }
          : event,
    }),
  ]);
}
interface Client {
  ws: WebSocket;
  hash: string;
  actor: string;
  station: string;
  identity: string;
  lastPing: number;
}
export class StationChatHub {
  private rooms = new Map<string, Set<Client>>();
  private listener: PoolClient | null = null;
  private listening: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private tickCount = 0;
  private detach: (() => void) | null = null;
  private send(c: Client, event: object) {
    try {
      if (c.ws.readyState !== 1) return;
      if (c.ws.bufferedAmount > 256 * 1024) {
        c.ws.close(1013, "Slow connection");
        return;
      }
      c.ws.send(JSON.stringify(event));
    } catch {
      c.ws.close();
    }
  }
  private async listen() {
    if (this.listener) return;
    if (this.listening) return this.listening;
    this.listening = (async () => {
      const client = await (await import("../postgres-runtime"))
        .getPostgresCoordinationPool()
        .connect();
      this.listener = client;
      const broken = () => {
        if (this.listener !== client) return;
        this.listener = null;
        this.detach?.();
        this.detach = null;
        client.release(true);
        for (const room of this.rooms.values())
          for (const c of room) c.ws.close(1012, "Reconnect");
      };
      const notification = (n: any) => {
        if (n.channel !== "mega_station_chat" || !n.payload) return;
        try {
          const { stationId, event } = JSON.parse(n.payload);
          void this.deliver(stationId, event);
        } catch {}
      };
      client.on("error", broken);
      client.on("notification", notification);
      this.detach = () => {
        client.removeListener("error", broken);
        client.removeListener("notification", notification);
      };
      try {
        await client.query("LISTEN mega_station_chat");
      } catch (e) {
        broken();
        throw e;
      }
    })().finally(() => (this.listening = null));
    return this.listening;
  }
  async connect(ws: WebSocket, token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) {
      ws.close(4001, "Invalid ticket");
      return;
    }
    const hash = ticketHash(token),
      db = getPostgresPool();
    const row = (
      await db.query(
        `UPDATE station_chat_sessions SET connected=true,expires_at=now()+interval '75 seconds' WHERE token_hash=$1 AND NOT connected AND expires_at>now() RETURNING station_id,user_id,identity_id`,
        [hash],
      )
    ).rows[0];
    if (!row) {
      ws.close(4001, "Expired ticket");
      return;
    }
    const c: Client = {
      ws,
      hash,
      actor: row.user_id || "",
      station: row.station_id,
      identity: row.identity_id,
      lastPing: Date.now(),
    };
    let closed = false;
    const remove = () => {
      if (closed) return;
      closed = true;
      const room = this.rooms.get(c.station);
      room?.delete(c);
      if (!room?.size) this.rooms.delete(c.station);
      void db
        .query("DELETE FROM station_chat_sessions WHERE token_hash=$1", [hash])
        .catch(() => {});
      if (!this.rooms.size) this.stop();
    };
    ws.on("close", remove);
    ws.on("error", remove);
    let packets = 0,
      packetWindow = Date.now();
    ws.on("message", (data) => {
      if (Date.now() - packetWindow > 60000) {
        packets = 0;
        packetWindow = Date.now();
      }
      if (++packets > 20 || Buffer.byteLength(data.toString()) > 16) {
        ws.close(1008, "Invalid heartbeat");
        return;
      }
      if (data.toString() === "ping") c.lastPing = Date.now();
    });
    if (!this.rooms.has(c.station)) this.rooms.set(c.station, new Set());
    this.rooms.get(c.station)!.add(c);
    try {
      await this.listen();
      if (ws.readyState !== 1 || closed) {
        remove();
        if (!this.rooms.size) this.stop();
        return;
      }

      this.send(c, { type: "connected" });
      await this.presence();
      if (!this.timer) {
        this.timer = setInterval(() => void this.tick(), 15000);
        this.timer.unref();
      }
    } catch {
      ws.close(1011, "Room unavailable");
      remove();
    }
  }
  private async deliver(station: string, event: any) {
    const clients = this.rooms.get(station);
    if (!clients?.size) return;
    try {
      if (event.type === "changed" && roomId(event.messageId)) {
        const message = (
          await getPostgresPool().query(
            messageSQL +
              " WHERE m.id=$1 AND m.station_id=$2 AND m.deleted_at IS NULL",
            [event.messageId, station],
          )
        ).rows[0];
        if (!message) return;
        const blocked = new Set(
          (
            await getPostgresPool().query(
              "SELECT user_id FROM station_chat_blocks WHERE blocked_user_id=$1 AND user_id=ANY($2::text[])",
              [message.userId, [...clients].map((c) => c.actor)],
            )
          ).rows.map((r) => r.user_id),
        );
        for (const c of clients)
          if (!blocked.has(c.actor)) this.send(c, { type: "message", message });
      } else for (const c of clients) this.send(c, event);
    } catch {
      for (const c of clients) this.send(c, { type: "resync" });
    }
  }
  private stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const client = this.listener;
    this.listener = null;
    this.detach?.();
    this.detach = null;
    if (client)
      void client
        .query("UNLISTEN mega_station_chat")
        .catch(() => {})
        .finally(() => client.release());
  }
  private async presence() {
    if (!this.rooms.size) return;
    const rows = (
      await getPostgresPool().query(
        `SELECT station_id,count(DISTINCT identity_id)::int count FROM station_chat_sessions WHERE connected AND expires_at>now() AND station_id=ANY($1::text[]) GROUP BY station_id`,
        [[...this.rooms.keys()]],
      )
    ).rows;
    const counts = new Map(rows.map((r) => [r.station_id, r.count]));
    for (const [id, room] of this.rooms)
      for (const c of room)
        this.send(c, { type: "presence", count: counts.get(id) || 0 });
  }
  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const active: Client[] = [];
      for (const room of this.rooms.values())
        for (const c of room) {
          if (Date.now() - c.lastPing > 60000)
            c.ws.close(4000, "Heartbeat expired");
          else active.push(c);
        }
      if (active.length)
        await getPostgresPool().query(
          "UPDATE station_chat_sessions SET expires_at=now()+interval '75 seconds' WHERE token_hash=ANY($1::text[])",
          [active.map((c) => c.hash)],
        );
      await this.presence();
      if (++this.tickCount % 20 === 0) {
        await getPostgresPool().query(
          "DELETE FROM station_chat_sessions WHERE token_hash IN(SELECT token_hash FROM station_chat_sessions WHERE expires_at<now() LIMIT 1000)",
        );
        await getPostgresPool().query(
          "DELETE FROM station_chat_messages WHERE id IN(SELECT id FROM station_chat_messages WHERE created_at<now()-interval '24 hours' ORDER BY created_at LIMIT 1000)",
        );
      }
    } catch {
      /* next heartbeat retries; do not invent presence or messages */
    } finally {
      this.ticking = false;
    }
  }
}
export const stationChatHub = new StationChatHub();
