//! Los nombres de carpeta de IMAP (RFC 3501, 5.1.3): UTF-7 modificado. «Año» viaja como `A&APE-o`.

use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine};

pub fn encode(s: &str) -> String {
    let mut out = String::new();
    let mut pending: Vec<u8> = vec![];
    let flush = |out: &mut String, pending: &mut Vec<u8>| {
        if !pending.is_empty() {
            out.push('&');
            out.push_str(&STANDARD_NO_PAD.encode(&pending).replace('/', ","));
            out.push('-');
            pending.clear();
        }
    };
    for c in s.chars() {
        if (' '..='~').contains(&c) {
            flush(&mut out, &mut pending);
            out.push(c);
            if c == '&' {
                out.push('-');
            }
        } else {
            let mut units = [0u16; 2];
            for u in c.encode_utf16(&mut units) {
                pending.extend_from_slice(&u.to_be_bytes());
            }
        }
    }
    flush(&mut out, &mut pending);
    out
}

/// Lo que no está bien codificado se deja como llegó (hay servidores que mandan UTF-8).
pub fn decode(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        let after = &rest[at + 1..];
        let Some(end) = after.find('-') else {
            out.push_str(&rest[at..]);
            return out;
        };
        let code = &after[..end];
        if code.is_empty() {
            out.push('&');
        } else {
            match one(code) {
                Some(text) => out.push_str(&text),
                None => out.push_str(&rest[at..at + end + 2]),
            }
        }
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    out
}

fn one(code: &str) -> Option<String> {
    let bytes = STANDARD_NO_PAD.decode(code.replace(',', "/")).ok()?;
    if bytes.len() % 2 != 0 {
        return None;
    }
    let units: Vec<u16> = bytes.chunks(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
    String::from_utf16(&units).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_and_decodes_like_the_standard() {
        for (plain, wire) in [
            ("INBOX", "INBOX"),
            ("Año", "A&APE-o"),
            ("Correo no deseado", "Correo no deseado"),
            ("Q&A", "Q&-A"),
            // el ejemplo de la RFC 3501
            ("~peter/mail/台北/日本語", "~peter/mail/&U,BTFw-/&ZeVnLIqe-"),
            ("Ofertas 📎", "Ofertas &2D3czg-"),
        ] {
            assert_eq!(encode(plain), wire, "{plain}");
            assert_eq!(decode(wire), plain, "{wire}");
        }
    }

    #[test]
    fn leaves_what_it_does_not_understand() {
        assert_eq!(decode("Año"), "Año");
        assert_eq!(decode("a & b"), "a & b");
        assert_eq!(decode("x&!!-y"), "x&!!-y");
    }
}
