//! TLS del sistema (SChannel en Windows, Security.framework en macOS, OpenSSL en Linux), compartido por todos los protocolos.
//! Siempre se valida el certificado del servidor.

use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

pub const TIMEOUT: Duration = Duration::from_secs(30);

pub fn connector() -> Result<native_tls::TlsConnector, String> {
    #[allow(unused_mut)]
    let mut b = native_tls::TlsConnector::builder();
    // Solo en compilaciones de depuración y solo para pruebas: una autoridad de certificación propia.
    #[cfg(debug_assertions)]
    if let Ok(path) = std::env::var("SUITENOVA_MAIL_TEST_CA") {
        let pem = std::fs::read(&path).map_err(|e| format!("No se pudo leer la CA de pruebas: {e}"))?;
        b.add_root_certificate(native_tls::Certificate::from_pem(&pem).map_err(|e| e.to_string())?);
    }
    b.build().map_err(|e| format!("No se pudo preparar TLS: {e}"))
}

pub fn tcp(host: &str, port: u16) -> Result<TcpStream, String> {
    let addrs: Vec<_> = (host, port).to_socket_addrs().map_err(|e| format!("No se encontró el servidor {host}: {e}"))?.collect();
    let mut last = String::from("sin direcciones");
    for a in addrs {
        match TcpStream::connect_timeout(&a, TIMEOUT) {
            Ok(s) => {
                let _ = s.set_read_timeout(Some(TIMEOUT));
                let _ = s.set_write_timeout(Some(TIMEOUT));
                return Ok(s);
            }
            Err(e) => last = e.to_string(),
        }
    }
    Err(format!("No se pudo conectar con {host}:{port}: {last}"))
}

/// Texto del servidor sin saltos de línea ni caracteres de control, para mostrarlo tal cual.
pub fn clean(s: &str) -> String {
    s.chars().filter(|c| !c.is_control()).take(300).collect()
}
