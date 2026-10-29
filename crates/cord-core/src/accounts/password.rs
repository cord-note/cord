//! bcrypt, exactly as Bun.password does it: secrets over 72 bytes are
//! SHA-512'd first. Every hash already on disk depends on this.

use sha2::{Digest, Sha512};

use crate::{Error, Result};

const BCRYPT_MAX_BYTES: usize = 72;

pub fn hash(secret: &str, cost: u32) -> Result<String> {
    bcrypt::hash(input(secret), cost).map_err(|e| Error::Invalid(format!("could not hash: {e}")))
}

/// False for a wrong secret and for a hash that does not parse.
pub fn verify(secret: &str, hash: &str) -> bool {
    bcrypt::verify(input(secret), hash).unwrap_or(false)
}

fn input(secret: &str) -> Vec<u8> {
    let bytes = secret.as_bytes();
    if bytes.len() > BCRYPT_MAX_BYTES {
        Sha512::digest(bytes).to_vec()
    } else {
        bytes.to_vec()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Made by Bun.password.hash(_, { algorithm: 'bcrypt', cost: 4 }).
    const BUN_SHORT: &str = "$2b$04$Y3AS0kaP.yAK8ZohrL0XVeB0LOMghmULrXGzI8fKQeO5GL/a0v0Fi";
    const BUN_72: &str = "$2b$04$wTwJNNHAZYMaWSco21aUA.2x8qCdfTHBRxKyLIvrBW18SHxhjGpn2";
    const BUN_73: &str = "$2b$04$YGnpimKsCD2BwGYExUizpOL1QpT74sirGGC3JfMvSvcr14JzfUWZq";

    #[test]
    fn verifies_hashes_bun_wrote() {
        assert!(verify("correct horse", BUN_SHORT));
        assert!(!verify("correct horsf", BUN_SHORT));
        assert!(verify(&"a".repeat(72), BUN_72));
        assert!(verify(&"a".repeat(73), BUN_73));
        assert!(!verify(&"a".repeat(74), BUN_73));
    }

    #[test]
    fn round_trips_short_and_long_secrets() {
        for secret in ["1234", &"x".repeat(100)] {
            let h = hash(secret, 4).unwrap();
            assert!(h.starts_with("$2b$04$"));
            assert!(verify(secret, &h));
        }
    }

    #[test]
    fn a_broken_hash_never_verifies() {
        assert!(!verify("anything", "not a hash"));
    }
}
