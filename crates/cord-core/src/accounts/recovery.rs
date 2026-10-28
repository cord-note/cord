//! Recovery keys: 20 random bytes in Crockford base32, as eight groups of
//! four. Crockford leaves out I, L, O and U, so hand-copied keys survive
//! the usual misreadings (see `normalise`).

use crate::{Error, Result};

const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
pub const RECOVERY_KEY_BYTES: usize = 20;

pub fn encode(bytes: &[u8]) -> String {
    let mut out = String::new();
    let mut buffer: u32 = 0;
    let mut bits: u32 = 0;
    for &b in bytes {
        buffer = ((buffer << 8) | u32::from(b)) & 0xffff; // never more than 12 live bits
        bits += 8;
        while bits >= 5 {
            out.push(ALPHABET[((buffer >> (bits - 5)) & 31) as usize] as char);
            bits -= 5;
        }
    }
    if bits > 0 {
        out.push(ALPHABET[((buffer << (5 - bits)) & 31) as usize] as char);
    }
    let chars: Vec<char> = out.chars().collect();
    chars.chunks(4).map(|c| c.iter().collect::<String>()).collect::<Vec<_>>().join("-")
}

pub fn generate() -> Result<String> {
    let mut bytes = [0u8; RECOVERY_KEY_BYTES];
    getrandom::getrandom(&mut bytes).map_err(|e| Error::Invalid(format!("no randomness: {e}")))?;
    Ok(encode(&bytes))
}

/// The form that is hashed and compared: uppercase, no separators, look-alikes folded.
pub fn normalise(input: &str) -> String {
    input
        .to_uppercase()
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .map(|c| match c {
            'O' => '0',
            'I' | 'L' => '1',
            other => other,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_typescript_encoding() {
        let counting: Vec<u8> = (0..20).collect();
        assert_eq!(encode(&counting), "000G-40R4-0M30-E209-185G-R38E-1W81-24GK");
        assert_eq!(encode(&[0xff; 20]), "ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ");
    }

    #[test]
    fn normalises_like_the_typescript() {
        assert_eq!(normalise(" k7qm-2xvd oil "), "K7QM2XVD011");
    }

    #[test]
    fn generates_eight_groups_of_four() {
        let key = generate().unwrap();
        let groups: Vec<&str> = key.split('-').collect();
        assert_eq!(groups.len(), 8);
        assert!(groups.iter().all(|g| g.len() == 4 && g.bytes().all(|b| ALPHABET.contains(&b))));
        assert_ne!(generate().unwrap(), key);
    }
}
