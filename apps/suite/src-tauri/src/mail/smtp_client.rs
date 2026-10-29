use super::account::{Account, Security};
use super::backend::Creds;
use lettre::address::Envelope;
use lettre::transport::smtp::authentication::{Credentials, Mechanism};
use lettre::transport::smtp::client::{Certificate, Tls, TlsParameters};
use lettre::{Address, SmtpTransport, Transport};
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(60);

fn transport(account: &Account, creds: &Creds) -> Result<SmtpTransport, String> {
    account.validate()?;
    let sv = &account.smtp;
    let host = sv.host.trim();
    let tls = || -> Result<TlsParameters, String> {
        let mut b = TlsParameters::builder(host.to_string());
        // Solo en compilaciones de depuración y solo para pruebas: una autoridad de certificación propia.
        #[cfg(debug_assertions)]
        if let Ok(path) = std::env::var("SUITENOVA_MAIL_TEST_CA") {
            let pem = std::fs::read(&path).map_err(|e| format!("No se pudo leer la CA de pruebas: {e}"))?;
            b = b.add_root_certificate(Certificate::from_pem(&pem).map_err(|e| e.to_string())?);
        }
        b.build_native().map_err(|e| format!("No se pudo preparar TLS: {e}"))
    };
    let builder = match sv.security {
        Security::Tls => SmtpTransport::builder_dangerous(host).tls(Tls::Wrapper(tls()?)),
        Security::StartTls => SmtpTransport::builder_dangerous(host).tls(Tls::Required(tls()?)),
        Security::None => SmtpTransport::builder_dangerous(host),
    };
    Ok(builder
        .port(sv.port)
        .timeout(Some(TIMEOUT))
        .credentials(Credentials::new(account.username.clone(), creds.secret().to_string()))
        .authentication(match creds {
            Creds::Password(_) => vec![Mechanism::Plain, Mechanism::Login],
            Creds::Token(_) => vec![Mechanism::Xoauth2],
        })
        .build())
}

fn explain(e: lettre::transport::smtp::Error) -> String {
    let t = e.to_string();
    if e.is_permanent() && t.to_lowercase().contains("auth") || t.contains("535") {
        return "El servidor no aceptó el usuario o la contraseña. Con Gmail, Outlook o iCloud hace falta una contraseña de aplicación (Outlook.com y Microsoft 365 piden OAuth).".into();
    }
    if e.is_timeout() {
        return "El servidor SMTP no respondió a tiempo. Comprueba el servidor y el puerto (algunas redes bloquean los puertos de correo).".into();
    }
    // sin respuesta del servidor: la conexión o el cifrado fallaron antes de poder hablar con él
    if e.is_tls() || !(e.is_response() || e.is_permanent() || e.is_transient()) {
        return format!("No se pudo establecer la conexión segura (¿el certificado es válido para este servidor?): {}", t.chars().filter(|c| !c.is_control()).take(300).collect::<String>());
    }
    format!("Error de SMTP: {}", t.chars().filter(|c| !c.is_control()).take(300).collect::<String>())
}

/// Comprueba que se puede conectar y autenticar.
pub fn test(account: &Account, creds: &Creds) -> Result<(), String> {
    match transport(account, creds)?.test_connection() {
        Ok(true) => Ok(()),
        Ok(false) => Err("El servidor SMTP no respondió como se esperaba.".into()),
        Err(e) => Err(explain(e)),
    }
}

/// Envía un mensaje ya construido (RFC 5322). Los destinatarios del sobre incluyen los ocultos (Cco).
pub fn send(account: &Account, creds: &Creds, from: &str, recipients: &[String], raw: &[u8]) -> Result<(), String> {
    if recipients.is_empty() {
        return Err("Falta algún destinatario.".into());
    }
    if recipients.len() > 200 {
        return Err("Demasiados destinatarios.".into());
    }
    if raw.len() > 40 * 1024 * 1024 {
        return Err("El mensaje es demasiado grande (más de 40 MB).".into());
    }
    let parse = |s: &str| -> Result<Address, String> { s.trim().parse::<Address>().map_err(|_| format!("La dirección «{}» no es válida.", s.chars().filter(|c| !c.is_control()).take(80).collect::<String>())) };
    let envelope = Envelope::new(Some(parse(from)?), recipients.iter().map(|r| parse(r)).collect::<Result<Vec<_>, _>>()?).map_err(|e| format!("Destinatarios no válidos: {e}"))?;
    // la biblioteca añade el salto de línea final del mensaje: se quita el nuestro para que no salga una línea vacía de más
    let body = raw.strip_suffix(&[13u8, 10u8][..]).unwrap_or(raw);
    transport(account, creds)?.send_raw(&envelope, body).map(|_| ()).map_err(explain)
}
