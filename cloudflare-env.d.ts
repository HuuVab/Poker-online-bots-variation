declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    CLUB_OWNER_EMAIL?: string;
    BUCKET?: R2Bucket;
  }
}
