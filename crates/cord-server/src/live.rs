//! The live channel.

#[derive(Clone)]
pub struct Hub;

impl Hub {
    pub fn new() -> Self {
        Self
    }
}

impl Default for Hub {
    fn default() -> Self {
        Self::new()
    }
}
