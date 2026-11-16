import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable("rooms", {
  code: text("code").primaryKey(),
  state: text("state").notNull(),
  version: integer("version").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});

export const clubs = sqliteTable("clubs", {
 id: text("id").primaryKey(), state: text("state").notNull(), version: integer("version").notNull(), lastCommit: text("last_commit").notNull(), updatedAt: integer("updated_at").notNull(),
});
export const clubLedger = sqliteTable("club_ledger", {
 id:text("id").primaryKey(), memberId:text("member_id").notNull(), actorId:text("actor_id").notNull(), kind:text("kind").notNull(), tableCode:text("table_code"), walletDelta:integer("wallet_delta").notNull(), tableDelta:integer("table_delta").notNull(), walletAfter:integer("wallet_after").notNull(), stackAfter:integer("stack_after"), reason:text("reason").notNull(), createdAt:integer("created_at").notNull(),
}, table=>[index("club_ledger_member_time").on(table.memberId,table.createdAt)]);
export const clubHands = sqliteTable("club_hands", {
 id:text("id").primaryKey(), tableCode:text("table_code").notNull(), hand:integer("hand").notNull(), data:text("data").notNull(), createdAt:integer("created_at").notNull(),
});
export const clubOperations = sqliteTable("club_operations", {
 id:integer("id").primaryKey({autoIncrement:true}), actorId:text("actor_id").notNull(), requestId:text("request_id").notNull(), fingerprint:text("fingerprint").notNull(), result:text("result").notNull(), createdAt:integer("created_at").notNull(),
}, table=>[uniqueIndex("club_operation_unique").on(table.actorId,table.requestId)]);
export const clubRateLimits = sqliteTable("club_rate_limits", {
 key:text("key").primaryKey(), window:integer("window").notNull(), count:integer("count").notNull(),
});

