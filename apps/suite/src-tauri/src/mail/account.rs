use serde::{Deserialize, Serialize};

/// Cómo se protege la conexión. `None` (sin cifrar) solo se admite hacia este mismo equipo, para pruebas.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Security {
    /// TLS desde el primer byte (IMAP 993, POP3 995, SMTP 465).
    Tls,
    /// Conexión normal que se cifra con STARTTLS (IMAP 143, POP3 110, SMTP 587).
    StartTls,
    None,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct Server {
    pub host: String,
    pub port: u16,
    pub security: Security,
}

/// Con qué protocolo se leen y gestionan los mensajes.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "lowercase")]
pub enum Protocol {
    #[default]
    Imap,
    Pop3,
    Jmap,
    /// Exchange Web Services (Exchange local; en Exchange Online está en retirada).
    Ews,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "lowercase")]
pub enum AuthKind {
    /// Contraseña (o contraseña de aplicación) guardada en el almacén seguro del sistema.
    #[default]
    Password,
    /// OAuth 2.0: el inicio de sesión se hace en el navegador y aquí solo se guarda un token renovable.
    Oauth,
    /// Un token de acceso fijo (por ejemplo una clave de API de Fastmail) que se envía como `Bearer`. Solo con JMAP y Exchange.
    Token,
}

/// Datos de OAuth que no son secretos. El token renovable (y el secreto del cliente, si lo hay) viven en el almacén seguro.
#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug, Default)]
pub struct OAuth {
    /// `google`, `microsoft` o `custom`.
    pub provider: String,
    /// Identificador de la aplicación registrada por quien usa Nova Mail (no hay uno compartido).
    pub client_id: String,
    /// Solo Microsoft: `common` (por defecto), `consumers`, `organizations` o el identificador del inquilino.
    #[serde(default)]
    pub tenant: Option<String>,
    /// Solo `custom`.
    #[serde(default)]
    pub auth_url: Option<String>,
    #[serde(default)]
    pub token_url: Option<String>,
    #[serde(default)]
    pub scope: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug, Default)]
pub struct Auth {
    #[serde(default)]
    pub kind: AuthKind,
    #[serde(default)]
    pub oauth: Option<OAuth>,
}

/// Datos de una cuenta que no son secretos. La contraseña vive solo en el almacén seguro del sistema.
#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct Account {
    pub id: String,
    pub name: String,
    pub email: String,
    pub username: String,
    /// Servidor de entrada (IMAP o POP3). Con JMAP o Exchange no se usa.
    pub imap: Server,
    /// Servidor de salida. Con JMAP o Exchange el envío va por el mismo servicio y no se usa.
    pub smtp: Server,
    #[serde(default)]
    pub protocol: Protocol,
    #[serde(default)]
    pub auth: Auth,
    /// Dirección del servicio (JMAP: sesión; Exchange: `…/EWS/Exchange.asmx`).
    #[serde(default)]
    pub url: Option<String>,
    /// ¿Guardar una copia de lo enviado en la carpeta Enviados del servidor? `None`: lo decide la página según el proveedor.
    #[serde(default)]
    pub save_sent: Option<bool>,
}

pub fn is_loopback(host: &str) -> bool {
    let h = host.trim().to_ascii_lowercase();
    h == "localhost" || h == "127.0.0.1" || h == "::1" || h == "[::1]"
}

fn check_server(label: &str, s: &Server) -> Result<(), String> {
    let h = s.host.trim();
    if h.is_empty() || h.len() > 253 {
        return Err(format!("{label}: falta el servidor."));
    }
    if !h.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == ':' || c == '[' || c == ']') {
        return Err(format!("{label}: el nombre del servidor no es válido."));
    }
    if s.port == 0 {
        return Err(format!("{label}: el puerto no es válido."));
    }
    if s.security == Security::None && !is_loopback(h) {
        return Err(format!("{label}: las conexiones sin cifrar solo se permiten hacia este mismo equipo."));
    }
    Ok(())
}

/// Una dirección web: siempre `https://`, salvo hacia este mismo equipo (pruebas). Sin usuario ni contraseña en la dirección.
pub fn check_url(label: &str, url: &str) -> Result<(), String> {
    let (https, rest) = if let Some(r) = url.strip_prefix("https://") {
        (true, r)
    } else if let Some(r) = url.strip_prefix("http://") {
        (false, r)
    } else {
        return Err(format!("{label}: la dirección debe empezar por https://."));
    };
    if url.len() > 2000 || url.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(format!("{label}: la dirección no es válida."));
    }
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() || authority.contains('@') {
        return Err(format!("{label}: la dirección no es válida."));
    }
    let host = if let Some(end) = authority.strip_prefix('[').and_then(|a| a.find(']')) { &authority[..end + 2] } else { authority.rsplit_once(':').map_or(authority, |(h, _)| h) };
    if !https && !is_loopback(host) {
        return Err(format!("{label}: las conexiones sin cifrar solo se permiten hacia este mismo equipo."));
    }
    Ok(())
}

impl Account {
    pub fn validate(&self) -> Result<(), String> {
        if self.id.is_empty() || self.id.len() > 64 || !self.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            return Err("El identificador de la cuenta no es válido.".into());
        }
        if self.name.chars().count() > 100 || self.name.chars().any(|c| c.is_control()) {
            return Err("El nombre de la cuenta no es válido.".into());
        }
        let at = self.email.find('@');
        if self.email.len() > 254 || at.map_or(true, |i| i == 0 || i + 1 >= self.email.len()) || self.email.chars().any(|c| c.is_control() || c.is_whitespace()) {
            return Err("La dirección de correo no es válida.".into());
        }
        if self.username.is_empty() || self.username.len() > 256 || self.username.chars().any(|c| c.is_control()) {
            return Err("El usuario no es válido.".into());
        }
        match self.protocol {
            Protocol::Imap => {
                check_server("IMAP", &self.imap)?;
                check_server("SMTP", &self.smtp)?;
            }
            Protocol::Pop3 => {
                check_server("POP3", &self.imap)?;
                check_server("SMTP", &self.smtp)?;
            }
            Protocol::Jmap | Protocol::Ews => {
                let label = if self.protocol == Protocol::Jmap { "JMAP" } else { "Exchange" };
                match self.url.as_deref() {
                    Some(u) if !u.is_empty() => check_url(label, u)?,
                    _ => return Err(format!("{label}: falta la dirección del servicio.")),
                }
            }
        }
        if self.auth.kind == AuthKind::Oauth {
            let o = self.auth.oauth.as_ref().ok_or("Falta la configuración de OAuth.")?;
            o.validate()?;
        }
        if self.auth.kind == AuthKind::Token && !matches!(self.protocol, Protocol::Jmap | Protocol::Ews) {
            return Err("El token de acceso solo se usa con JMAP y Exchange.".into());
        }
        Ok(())
    }

    /// ¿Cambia algo que decide a dónde se envía la contraseña (o el inicio de sesión)?
    pub fn changes_destination(&self, other: &Account) -> bool {
        let low = |s: &str| s.trim().to_ascii_lowercase();
        low(&self.imap.host) != low(&other.imap.host)
            || low(&self.smtp.host) != low(&other.smtp.host)
            || self.imap.port != other.imap.port
            || self.smtp.port != other.smtp.port
            || self.username != other.username
            || self.protocol != other.protocol
            || self.url.as_deref().map(low) != other.url.as_deref().map(low)
            || self.auth.kind != other.auth.kind
            || self.auth.oauth != other.auth.oauth
    }
}

fn plain(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && !s.chars().any(|c| c.is_control() || c.is_whitespace())
}

impl OAuth {
    pub fn validate(&self) -> Result<(), String> {
        if !["google", "microsoft", "custom"].contains(&self.provider.as_str()) {
            return Err("El proveedor de OAuth no es válido.".into());
        }
        if !plain(&self.client_id, 300) {
            return Err("Falta el identificador de cliente (Client ID) de la aplicación registrada.".into());
        }
        if let Some(t) = &self.tenant {
            if !t.is_empty() && !(t.len() <= 100 && t.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')) {
                return Err("El inquilino de Microsoft no es válido.".into());
            }
        }
        if self.provider == "custom" {
            for (label, u) in [("Dirección de autorización", &self.auth_url), ("Dirección del token", &self.token_url)] {
                match u.as_deref() {
                    Some(u) if !u.is_empty() => check_url(label, u)?,
                    _ => return Err(format!("{label}: falta.")),
                }
            }
            if self.scope.as_deref().map_or(true, |s| s.trim().is_empty() || s.len() > 500 || s.chars().any(|c| c.is_control())) {
                return Err("Falta el ámbito (scope) de OAuth.".into());
            }
        }
        Ok(())
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;

    pub fn sample() -> Account {
        Account {
            id: "cuenta-1".into(),
            name: "Personal".into(),
            email: "ana@ejemplo.es".into(),
            username: "ana@ejemplo.es".into(),
            imap: Server { host: "imap.ejemplo.es".into(), port: 993, security: Security::Tls },
            smtp: Server { host: "smtp.ejemplo.es".into(), port: 587, security: Security::StartTls },
            protocol: Protocol::Imap,
            auth: Auth::default(),
            url: None,
            save_sent: None,
        }
    }

    #[test]
    fn accepts_a_normal_account() {
        assert!(sample().validate().is_ok());
    }

    #[test]
    fn rejects_bad_values() {
        let mut a = sample();
        a.id = "../etc".into();
        assert!(a.validate().is_err());
        let mut a = sample();
        a.id = "a#oauth".into();
        assert!(a.validate().is_err(), "el # se reserva para las claves de OAuth");
        let mut a = sample();
        a.email = "sin-arroba".into();
        assert!(a.validate().is_err());
        let mut a = sample();
        a.imap.host = "malo.com/otra cosa".into();
        assert!(a.validate().is_err());
        let mut a = sample();
        a.smtp.port = 0;
        assert!(a.validate().is_err());
        let mut a = sample();
        a.username = "ana\r\nAUTH".into();
        assert!(a.validate().is_err());
    }

    #[test]
    fn plain_text_only_to_this_computer() {
        let mut a = sample();
        a.imap.security = Security::None;
        assert!(a.validate().unwrap_err().contains("sin cifrar"));
        a.imap.host = "127.0.0.1".into();
        a.smtp = Server { host: "localhost".into(), port: 2525, security: Security::None };
        assert!(a.validate().is_ok());
    }

    #[test]
    fn destination_changes_are_detected() {
        let a = sample();
        let mut b = a.clone();
        b.name = "Otro nombre".into();
        b.email = "otra@ejemplo.es".into();
        assert!(!a.changes_destination(&b));
        b.imap.host = "IMAP.EJEMPLO.ES".into();
        assert!(!a.changes_destination(&b));
        b.imap.host = "malo.example".into();
        assert!(a.changes_destination(&b));
        let mut c = a.clone();
        c.username = "otro".into();
        assert!(a.changes_destination(&c));
        let mut d = a.clone();
        d.protocol = Protocol::Pop3;
        assert!(a.changes_destination(&d));
    }

    #[test]
    fn web_services_need_https_except_on_this_computer() {
        let mut a = sample();
        a.protocol = Protocol::Jmap;
        assert!(a.validate().unwrap_err().contains("falta la dirección"));
        a.url = Some("http://mail.ejemplo.es/jmap".into());
        assert!(a.validate().unwrap_err().contains("sin cifrar"));
        a.url = Some("https://usuario:clave@mail.ejemplo.es/jmap".into());
        assert!(a.validate().is_err(), "sin credenciales dentro de la dirección");
        a.url = Some("https://api.ejemplo.es/jmap/session".into());
        assert!(a.validate().is_ok());
        a.url = Some("http://127.0.0.1:8080/jmap/session".into());
        assert!(a.validate().is_ok());
        a.url = Some("http://[::1]:8080/x".into());
        assert!(a.validate().is_ok());
        a.url = Some("ftp://x".into());
        assert!(a.validate().is_err());
    }

    #[test]
    fn oauth_needs_a_client_and_custom_providers_need_https_endpoints() {
        let mut a = sample();
        a.auth = Auth { kind: AuthKind::Oauth, oauth: None };
        assert!(a.validate().is_err());
        a.auth.oauth = Some(OAuth { provider: "google".into(), client_id: "".into(), ..Default::default() });
        assert!(a.validate().unwrap_err().contains("Client ID"));
        a.auth.oauth = Some(OAuth { provider: "google".into(), client_id: "abc.apps.googleusercontent.com".into(), ..Default::default() });
        assert!(a.validate().is_ok());
        a.auth.oauth = Some(OAuth { provider: "custom".into(), client_id: "x".into(), auth_url: Some("https://id.ejemplo.es/auth".into()), token_url: Some("http://id.ejemplo.es/token".into()), scope: Some("mail".into()), tenant: None });
        assert!(a.validate().unwrap_err().contains("sin cifrar"));
        a.auth.oauth.as_mut().unwrap().token_url = Some("https://id.ejemplo.es/token".into());
        assert!(a.validate().is_ok());
        let old = sample();
        let mut b = old.clone();
        b.auth = Auth { kind: AuthKind::Oauth, oauth: Some(OAuth { provider: "google".into(), client_id: "x".into(), ..Default::default() }) };
        assert!(old.changes_destination(&b));
    }

    #[test]
    fn accounts_saved_before_these_options_still_load() {
        let old = r#"{"id":"a","name":"n","email":"a@b.es","username":"a","imap":{"host":"imap.b.es","port":993,"security":"tls"},"smtp":{"host":"smtp.b.es","port":465,"security":"tls"}}"#;
        let a: Account = serde_json::from_str(old).unwrap();
        assert_eq!(a.protocol, Protocol::Imap);
        assert_eq!(a.auth.kind, AuthKind::Password);
        assert!(a.url.is_none());
    }
}
