-- Remove retired balances from every member, including inactive accounts.
UPDATE clubs SET state = json_set(state, '$.members', json((
 SELECT json_group_object(key, json(json_remove(value, '$.wallet', '$.legacyWallet')))
 FROM json_each(clubs.state, '$.members')
)));
--> statement-breakpoint
-- Ticket/point audit rows remain; retired wallet-only history is removed.
DELETE FROM club_ledger WHERE resource IS NULL;
--> statement-breakpoint
ALTER TABLE club_ledger DROP COLUMN wallet_delta;
--> statement-breakpoint
ALTER TABLE club_ledger DROP COLUMN wallet_after;
