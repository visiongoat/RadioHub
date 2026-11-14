import { randomBytes } from "node:crypto";
import type { Express, RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { getPostgresPool } from "../postgres-runtime";
import { getPublicStationByIdentifier } from "../data/station-read-store";
import {
  notifyRoom,
  roomId,
  roomPage,
  sendRoomMessage,
  ticketHash,
} from "../services/station-live-chat";
export function registerStationChatRoutes(
  app: Express,
  auth: RequestHandler,
  admin: RequestHandler,
) {
  const limited = rateLimit({
    windowMs: 60000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const optional: RequestHandler = (req: any, res, next) => {
    if (
      req.headers.authorization ||
      req.session?.user?.userId ||
      req.session?.userId
    )
      void auth(req, res, next);
    else next();
  };
  const actor = (req: any) =>
    String(
      req.user?._id ||
        req.user?.id ||
        req.session?.user?.userId ||
        req.session?.userId ||
        "",
    );
  const route = (
    method: "get" | "post",
    path: string,
    guards: RequestHandler[],
    run: (req: any) => Promise<any>,
  ) =>
    app[method](path, ...guards, async (req, res) => {
      res.setHeader("Cache-Control", "private, no-store");
      try {
        res.json(await run(req));
      } catch (e: any) {
        res
          .status(e.status || 503)
          .json({ error: e.status ? e.message : "CHAT_UNAVAILABLE" });
      }
    });
  const validate = async (req: any) => {
    if (!roomId(req.params.station))
      throw Object.assign(Error("ROOM_UNAVAILABLE"), { status: 404 });
    const station = await getPublicStationByIdentifier(req.params.station);
    if (!station || station.redirectToSlug)
      throw Object.assign(Error("ROOM_UNAVAILABLE"), { status: 404 });
    return station;
  };
  route(
    "post",
    "/api/station-chat/:station/join",
    [limited, optional],
    async (req) => {
      await validate(req);
      const user = actor(req);
      const guest = req.body?.guestId;
      if (
        !user &&
        (typeof guest !== "string" || !/^[a-f0-9-]{32,40}$/i.test(guest))
      )
        throw Object.assign(Error("INVALID_SESSION"), { status: 400 });
      const token = randomBytes(32).toString("hex");
      await getPostgresPool().query(
        `INSERT INTO station_chat_sessions(token_hash,station_id,user_id,identity_id) VALUES($1,$2,$3,$4)`,
        [
          ticketHash(token),
          req.params.station,
          user || null,
          user || "guest:" + ticketHash(guest),
        ],
      );
      return { ticket: token, ...(await roomPage(req.params.station, user)) };
    },
  );
  route(
    "get",
    "/api/station-chat/:station/messages",
    [limited, optional],
    async (req) => {
      await validate(req);
      if (req.query.before && !roomId(req.query.before))
        throw Object.assign(Error("INVALID_CURSOR"), { status: 400 });
      return roomPage(
        req.params.station,
        actor(req),
        req.query.before as string,
      );
    },
  );
  route(
    "post",
    "/api/station-chat/:station/messages",
    [limited, auth],
    async (req) => {
      await validate(req);
      return {
        message: await sendRoomMessage(
          req.params.station,
          actor(req),
          req.body,
        ),
      };
    },
  );
  route(
    "post",
    "/api/station-chat/:station/delete",
    [limited, auth],
    async (req) => {
      if (!roomId(req.params.station) || !roomId(req.body?.messageId))
        throw Object.assign(Error("INVALID_MESSAGE"), { status: 400 });
      const db = await getPostgresPool().connect();
      try {
        await db.query("BEGIN");
        const row = (
          await db.query(
            `UPDATE station_chat_messages SET content='Silinen mesaj',deleted_at=now() WHERE id=$1 AND station_id=$2 AND user_id=$3 AND created_at>now()-interval '48 hours' AND deleted_at IS NULL RETURNING id`,
            [req.body.messageId, req.params.station, actor(req)],
          )
        ).rows[0];
        if (!row)
          throw Object.assign(Error("MESSAGE_UNAVAILABLE"), { status: 404 });
        await notifyRoom(db, req.params.station, {
          type: "deleted",
          messageId: row.id,
        });
        await db.query("COMMIT");
        return { success: true };
      } catch (e) {
        await db.query("ROLLBACK");
        throw e;
      } finally {
        db.release();
      }
    },
  );
  route(
    "post",
    "/api/station-chat/:station/report",
    [limited, auth],
    async (req) => {
      if (!roomId(req.params.station) || !roomId(req.body?.messageId))
        throw Object.assign(Error("INVALID_MESSAGE"), { status: 400 });
      const reason =
        typeof req.body.reason === "string"
          ? req.body.reason.trim().slice(0, 200)
          : "Inappropriate message";
      await getPostgresPool().query(
        `INSERT INTO station_chat_reports(id,station_id,message_id,reporter_id,reported_user_id,content_snapshot,reason) SELECT $1,m.station_id,m.id,$2,m.user_id,m.content,$3 FROM station_chat_messages m WHERE m.id=$4 AND m.station_id=$5 AND m.deleted_at IS NULL ON CONFLICT(message_id,reporter_id) DO NOTHING`,
        [
          randomBytes(12).toString("hex"),
          actor(req),
          reason || "Inappropriate message",
          req.body.messageId,
          req.params.station,
        ],
      );
      return { success: true };
    },
  );
  route("post", "/api/station-chat/block", [limited, auth], async (req) => {
    if (!roomId(req.body?.userId) || req.body.userId === actor(req))
      throw Object.assign(Error("INVALID_USER"), { status: 400 });
    await getPostgresPool().query(
      "INSERT INTO station_chat_blocks(user_id,blocked_user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [actor(req), req.body.userId],
    );
    return { success: true };
  });
  route("get", "/api/admin/station-chat/reports", [admin], async () => ({
    reports: (
      await getPostgresPool().query(
        "SELECT * FROM station_chat_reports WHERE status='pending' ORDER BY created_at DESC LIMIT 100",
      )
    ).rows,
  }));
  route("post", "/api/admin/station-chat/moderate", [admin], async (req) => {
    const {
      userId,
      messageId,
      hours = 24,
      reportId,
      status = "resolved",
    } = req.body || {};
    if (
      (userId && !roomId(userId)) ||
      (messageId && !roomId(messageId)) ||
      (reportId && !roomId(reportId)) ||
      !["resolved", "dismissed"].includes(status) ||
      !Number.isFinite(hours) ||
      hours < 1 ||
      hours > 8760
    )
      throw Object.assign(Error("INVALID_ACTION"), { status: 400 });
    const db = await getPostgresPool().connect();
    try {
      await db.query("BEGIN");
      if (userId)
        await db.query(
          `INSERT INTO station_chat_sanctions(user_id,expires_at,reason) VALUES($1,now()+$2*interval '1 hour','Moderator action') ON CONFLICT(user_id) DO UPDATE SET expires_at=EXCLUDED.expires_at,reason=EXCLUDED.reason,updated_at=now()`,
          [userId, hours],
        );
      if (messageId) {
        const row = (
          await db.query(
            "UPDATE station_chat_messages SET content='Silinen mesaj',deleted_at=now() WHERE id=$1 RETURNING station_id",
            [messageId],
          )
        ).rows[0];
        if (row)
          await notifyRoom(db, row.station_id, { type: "deleted", messageId });
      }
      if (reportId)
        await db.query(
          "UPDATE station_chat_reports SET status=$2 WHERE id=$1",
          [reportId, status],
        );
      await db.query("COMMIT");
      return { success: true };
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  });
}
