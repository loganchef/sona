use chrono::Utc;

/// RFC3339 timestamp, directly consumable by `new Date()` on the frontend.
pub fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

/// Random identifier for newly created records.
pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}
