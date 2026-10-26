use std::collections::{BTreeMap, BTreeSet};

use chrono::{DateTime, Local};

use crate::model::history::DayStat;
use crate::model::{HistoryEntry, Stats};

/// Typing speed used for the "time saved" estimate: ~3.6 characters per second
/// is a comfortable sustained rate for mixed Chinese/English.
const CHARS_PER_SECOND: f64 = 3.6;

pub fn compute(entries: &[HistoryEntry], now: DateTime<Local>) -> Stats {
    let today = now.format("%Y-%m-%d").to_string();

    let mut stats = Stats::default();
    let mut asr_sum: u64 = 0;
    let mut polish_sum: u64 = 0;
    let mut polished: u64 = 0;
    let mut total_seconds: f64 = 0.0;
    let mut total_chars: u32 = 0;
    let mut days: BTreeSet<String> = BTreeSet::new();
    let mut per_day: BTreeMap<String, (u32, u32)> = BTreeMap::new();

    for entry in entries {
        let created = DateTime::parse_from_rfc3339(&entry.created_at)
            .map(|value| value.with_timezone(&Local))
            .unwrap_or(now);

        let key = created.format("%Y-%m-%d").to_string();
        days.insert(key.clone());
        let bucket = per_day.entry(key).or_insert((0, 0));
        bucket.0 += 1;
        bucket.1 += entry.chars;

        stats.total_count += 1;
        asr_sum += entry.asr_ms;
        if entry.polish_ms > 0 {
            polish_sum += entry.polish_ms;
            polished += 1;
        }
        total_seconds += entry.duration_ms as f64 / 1000.0;
        total_chars += entry.chars;

        if created.format("%Y-%m-%d").to_string() == today {
            stats.today_count += 1;
            stats.today_chars += entry.chars;
            stats.today_seconds += (entry.duration_ms / 1000) as u32;
        }
    }

    if stats.total_count > 0 {
        stats.avg_asr_ms = asr_sum / stats.total_count as u64;
    }
    stats.avg_polish_ms = polish_sum.checked_div(polished).unwrap_or(0);

    let typing_seconds = total_chars as f64 / CHARS_PER_SECOND;
    let saved = typing_seconds - total_seconds;
    stats.saved_minutes = if saved > 0.0 {
        (saved / 60.0).round() as u32
    } else {
        0
    };

    stats.streak_days = streak(&days, &now);

    if stats.today_seconds > 0 {
        stats.chars_per_min =
            ((stats.today_chars as f64 / stats.today_seconds as f64) * 60.0).round() as u32;
    }

    // Fourteen days, oldest first — the dashboard draws them without needing to
    // know anything about dates.
    let mut window: Vec<DayStat> = Vec::with_capacity(14);
    for offset in (0..14).rev() {
        let day = now - chrono::Duration::days(offset);
        let key = day.format("%Y-%m-%d").to_string();
        let (count, chars) = per_day.get(&key).copied().unwrap_or((0, 0));
        window.push(DayStat {
            date: key,
            count,
            chars,
        });
    }
    stats.days = window;

    stats
}

/// Consecutive days with at least one dictation, counting back from today.
fn streak(days: &BTreeSet<String>, now: &DateTime<Local>) -> u32 {
    let mut count = 0;
    let mut cursor = *now;

    // Starting today: if there is no entry today, the streak may still be alive
    // from yesterday, so allow one free step.
    if !days.contains(&cursor.format("%Y-%m-%d").to_string()) {
        cursor -= chrono::Duration::days(1);
    }

    loop {
        let key = cursor.format("%Y-%m-%d").to_string();
        if !days.contains(&key) {
            break;
        }
        count += 1;
        cursor -= chrono::Duration::days(1);
    }

    count
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(created_at: &str, chars: u32, duration_ms: u64) -> HistoryEntry {
        HistoryEntry {
            id: created_at.into(),
            created_at: created_at.into(),
            raw: String::new(),
            text: String::new(),
            mode: "light".into(),
            asr_model: "m".into(),
            polish_model: "p".into(),
            duration_ms,
            asr_ms: 400,
            polish_ms: 600,
            chars,
            app: String::new(),
            inserted: true,
            copied: false,
            edited: false,
        }
    }

    #[test]
    fn counts_today_and_totals() {
        let now = Local::now();
        let today = now.to_rfc3339();
        let entries = vec![
            entry(&today, 100, 60_000),
            entry(&today, 50, 30_000),
            entry("2020-01-01T00:00:00Z", 10, 1_000),
        ];

        let stats = compute(&entries, now);
        assert_eq!(stats.total_count, 3);
        assert_eq!(stats.today_count, 2);
        assert_eq!(stats.today_chars, 150);
        assert_eq!(stats.today_seconds, 90);
    }

    #[test]
    fn saved_minutes_never_negative() {
        let now = Local::now();
        let entries = vec![entry(&now.to_rfc3339(), 1, 600_000)];
        assert_eq!(compute(&entries, now).saved_minutes, 0);
    }

    #[test]
    fn exposes_two_weeks_of_activity() {
        let now = Local::now();
        let entries = vec![entry(&now.to_rfc3339(), 90, 30_000)];
        let stats = compute(&entries, now);

        assert_eq!(stats.days.len(), 14);
        assert_eq!(stats.days.last().unwrap().count, 1);
        assert_eq!(stats.chars_per_min, 180);
    }

    #[test]
    fn streak_counts_consecutive_days() {
        let now = Local::now();
        let mut entries = Vec::new();
        for offset in 0..3 {
            let day = now - chrono::Duration::days(offset);
            entries.push(entry(&day.to_rfc3339(), 10, 1_000));
        }
        assert_eq!(compute(&entries, now).streak_days, 3);
    }
}
