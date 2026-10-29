//! Cliente HTTP (JMAP, Exchange y OAuth) con el TLS del sistema. Solo `https://`, o `http://` hacia este mismo equipo.

use super::account::check_url;
use super::tls::{clean, connector};
use std::sync::Arc;
use std::time::Duration;

pub fn agent() -> Result<ureq::Agent, String> {
    Ok(ureq::AgentBuilder::new().tls_connector(Arc::new(connector()?)).timeout(Duration::from_secs(60)).redirects(3).build())
}

pub fn explain(e: ureq::Error) -> String {
    match e {
        ureq::Error::Status(401, _) | ureq::Error::Status(403, _) => "El servidor no aceptó las credenciales (usuario, contraseña o permisos).".to_string(),
        ureq::Error::Status(code, r) => {
            let body = r.into_string().unwrap_or_default();
            format!("El servidor respondió con el error {code}: {}", clean(&body).chars().take(160).collect::<String>())
        }
        ureq::Error::Transport(t) => {
            let msg = t.to_string();
            if msg.to_lowercase().contains("tls") || msg.to_lowercase().contains("certificate") || msg.to_lowercase().contains("handshake") {
                format!("No se pudo establecer la conexión segura (¿el certificado es válido para este servidor?): {}", clean(&msg))
            } else {
                format!("Error de red: {}", clean(&msg))
            }
        }
    }
}

/// Comprueba la dirección antes de usarla.
pub fn checked(label: &str, url: &str) -> Result<String, String> {
    check_url(label, url)?;
    Ok(url.to_string())
}

/// Acaba de leer el cuerpo con un límite de tamaño.
pub fn read_limited(r: ureq::Response, max: u64) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let mut out = Vec::new();
    r.into_reader().take(max + 1).read_to_end(&mut out).map_err(|e| format!("Error de red: {e}"))?;
    if out.len() as u64 > max {
        return Err("La respuesta del servidor es demasiado grande.".into());
    }
    Ok(out)
}
