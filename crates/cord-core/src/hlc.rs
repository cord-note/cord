use crate::{Error, Result};

const MAX_COUNTER: u32 = 999_999;

/// A hybrid clock stamp. Field order matters: derived `Ord` compares wall,
/// then counter, then device — the same order as the encoded text.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Hlc {
    pub wall: u64,
    pub counter: u32,
    pub device: String,
}

impl Hlc {
    /// Fixed-width text, so comparing two encoded stamps as strings orders them.
    pub fn encode(&self) -> String {
        format!("{:013}-{:06}-{}", self.wall, self.counter, self.device)
    }

    pub fn parse(s: &str) -> Result<Self> {
        let bad = || Error::BadHlc(s.to_owned());
        let mut parts = s.splitn(3, '-');
        let (wall, counter, device) = match (parts.next(), parts.next(), parts.next()) {
            (Some(w), Some(c), Some(d)) => (w, c, d),
            _ => return Err(bad()),
        };
        if wall.len() != 13 || counter.len() != 6 || device.is_empty() {
            return Err(bad());
        }
        Ok(Self {
            wall: wall.parse().map_err(|_| bad())?,
            counter: counter.parse().map_err(|_| bad())?,
            device: device.to_owned(),
        })
    }
}

/// Issues stamps for one device; never goes backwards.
#[derive(Debug, Clone)]
pub struct HlcClock {
    last: Hlc,
}

impl HlcClock {
    pub fn new(device: impl Into<String>) -> Self {
        Self { last: Hlc { wall: 0, counter: 0, device: device.into() } }
    }

    /// Continue after a restart from the newest stamp on record.
    pub fn resume(device: impl Into<String>, latest: Option<&Hlc>) -> Self {
        let mut clock = Self::new(device);
        if let Some(l) = latest {
            clock.last.wall = l.wall;
            clock.last.counter = l.counter;
        }
        clock
    }

    /// Stamp a local change.
    pub fn tick(&mut self, now_ms: u64) -> Hlc {
        if now_ms > self.last.wall {
            self.last.wall = now_ms;
            self.last.counter = 0;
        } else {
            self.bump();
        }
        self.last.clone()
    }

    /// Account for a stamp received from elsewhere, so the next tick is newer.
    pub fn observe(&mut self, remote: &Hlc, now_ms: u64) {
        let wall = now_ms.max(self.last.wall).max(remote.wall);
        let counter = match (wall == self.last.wall, wall == remote.wall) {
            (true, true) => self.last.counter.max(remote.counter) + 1,
            (true, false) => self.last.counter + 1,
            (false, true) => remote.counter + 1,
            (false, false) => 0,
        };
        self.last.wall = wall;
        self.last.counter = counter;
        if counter > MAX_COUNTER {
            self.last.wall += 1;
            self.last.counter = 0;
        }
    }

    fn bump(&mut self) {
        if self.last.counter >= MAX_COUNTER {
            self.last.wall += 1;
            self.last.counter = 0;
        } else {
            self.last.counter += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn h(wall: u64, counter: u32, device: &str) -> Hlc {
        Hlc { wall, counter, device: device.into() }
    }

    #[test]
    fn encodes_fixed_width_and_parses_back() {
        let stamp = h(1_761_000_000_000, 42, "dev-_1");
        assert_eq!(stamp.encode(), "1761000000000-000042-dev-_1");
        assert_eq!(Hlc::parse(&stamp.encode()).unwrap(), stamp);
    }

    #[test]
    fn rejects_malformed_text() {
        for bad in ["", "abc", "1761000000000-000042", "176100000000-000042-d", "1761000000000-42-d", "1761000000000-000042-"] {
            assert!(matches!(Hlc::parse(bad), Err(Error::BadHlc(_))), "{bad:?}");
        }
    }

    #[test]
    fn string_order_matches_struct_order() {
        let mut stamps = vec![h(9, 0, "b"), h(10, 0, "a"), h(9, 1, "a"), h(9, 0, "a")];
        let mut texts: Vec<String> = stamps.iter().map(Hlc::encode).collect();
        stamps.sort();
        texts.sort();
        assert_eq!(texts, stamps.iter().map(Hlc::encode).collect::<Vec<_>>());
    }

    #[test]
    fn tick_follows_wall_time_and_resets_counter() {
        let mut c = HlcClock::new("d");
        assert_eq!(c.tick(100), h(100, 0, "d"));
        assert_eq!(c.tick(200), h(200, 0, "d"));
    }

    #[test]
    fn tick_never_goes_backwards_when_the_clock_does() {
        let mut c = HlcClock::new("d");
        let a = c.tick(500);
        let b = c.tick(400);
        let d = c.tick(500);
        assert!(a < b && b < d);
        assert_eq!(b, h(500, 1, "d"));
    }

    #[test]
    fn counter_overflow_moves_wall_forward() {
        let mut c = HlcClock::resume("d", Some(&h(500, MAX_COUNTER, "x")));
        assert_eq!(c.tick(100), h(501, 0, "d"));
    }

    #[test]
    fn resume_continues_after_the_latest_stamp() {
        let mut c = HlcClock::resume("d", Some(&h(900, 3, "other")));
        assert_eq!(c.tick(100), h(900, 4, "d"));
        let mut fresh = HlcClock::resume("d", None);
        assert_eq!(fresh.tick(100), h(100, 0, "d"));
    }

    #[test]
    fn observe_makes_the_next_tick_newer_than_the_remote() {
        let mut c = HlcClock::new("a");
        c.tick(100);
        let remote = h(5_000, 7, "b");
        c.observe(&remote, 200);
        let next = c.tick(200);
        assert!(next > remote);
        assert_eq!(next, h(5_000, 9, "a"));
    }

    #[test]
    fn observe_an_older_remote_changes_nothing_visible() {
        let mut c = HlcClock::new("a");
        c.tick(1_000);
        c.observe(&h(10, 0, "b"), 1_000);
        assert_eq!(c.tick(2_000), h(2_000, 0, "a"));
    }
}
