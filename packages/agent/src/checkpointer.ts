import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

let _saver: PostgresSaver | null = null;

/**
 * Returns a singleton PostgresSaver backed by DATABASE_URL.
 * On first call, creates the LangGraph checkpoint tables (idempotent).
 *
 * Prefer Supabase **Session pooler** in DATABASE_URL when your network is IPv4-only:
 * the direct host `db.<ref>.supabase.co` often has only AAAA DNS records, which can
 * make Node report `getaddrinfo ENOTFOUND`. Do not use Transaction pooler (6543)
 * for this saver unless your driver is configured for it.
 */
export async function getCheckpointer(): Promise<PostgresSaver> {
  if (!_saver) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL environment variable is required for LangGraph checkpointing");
    }
    _saver = PostgresSaver.fromConnString(url);
    await _saver.setup();
  }
  return _saver;
}
