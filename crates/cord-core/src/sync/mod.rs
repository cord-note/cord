//! Sync without networking: the wire format, outgoing batches, applying
//! incoming ones, linking vaults and server connections.

pub mod wire;
pub mod outbox;
pub mod apply;
pub mod link;
pub mod connections;
