use super::account::{Account, Security};
use super::backend::{check_flag, parse_keys_u32, Backend, Creds, Fetched, FolderState, RemoteFolder, RemoteMessage, Skipped, StateItem};
use super::smtp_client;
use super::tls::{clean, connector, tcp};
use base64::Engine;
use std::cell::Cell;
use std::net::TcpStream;

enum Sess {
    Tls(imap::Session<native_tls::TlsStream<TcpStream>>),
    Plain(imap::Session<TcpStream>),
}

macro_rules! on {
    ($s:expr, $v:ident => $e:expr) => {
        match $s {
            Sess::Tls($v) => $e,
            Sess::Plain($v) => $e,
        }
    };
}

fn explain(e: imap::Error) -> String {
    match e {
        imap::Error::No(m) => format!("El servidor rechazó la operación: {}", clean(&m.to_string())),
        imap::Error::Bad(m) => format!("El servidor no entendió la petición: {}", clean(&m.to_string())),
        imap::Error::Io(e) => format!("Error de red: {e}"),
        imap::Error::TlsHandshake(e) => format!("No se pudo establecer la conexión segura (¿el certificado es válido para este servidor?): {e}"),
        imap::Error::Tls(e) => format!("Error de TLS: {e}"),
        other => format!("Error de IMAP: {other}"),
    }
}

/// XOAUTH2: el usuario y el token de acceso. Si el servidor rechaza el token manda un aviso y hay que contestar vacío.
struct XOAuth2 {
    user: String,
    token: String,
    answered: Cell<bool>,
}

impl imap::Authenticator for XOAuth2 {
    type Response = String;
    fn process(&self, _challenge: &[u8]) -> String {
        if self.answered.replace(true) {
            return String::new();
        }
        format!("user={}\x01auth=Bearer {}\x01\x01", self.user, self.token)
    }
}

/// Una sesión IMAP ya autenticada. Siempre valida el certificado del servidor.
pub struct Imap {
    s: Sess,
    account: Account,
    creds: Creds,
    has_move: bool,
    has_uidplus: bool,
}

macro_rules! login {
    ($client:expr, $account:expr, $creds:expr) => {
        match $creds {
            Creds::Password(p) => $client.login(&$account.username, p).map_err(|(e, _)| login_error(e, false)),
            Creds::Token(t) => $client.authenticate("XOAUTH2", &XOAuth2 { user: $account.username.clone(), token: t.clone(), answered: Cell::new(false) }).map_err(|(e, _)| login_error(e, true)),
        }
    };
}

impl Imap {
    pub fn connect(account: &Account, creds: &Creds) -> Result<Imap, String> {
        account.validate()?;
        let sv = &account.imap;
        let host = sv.host.trim();
        let s = match sv.security {
            Security::Tls => {
                let tls = connector()?.connect(host, tcp(host, sv.port)?).map_err(|e| format!("No se pudo establecer la conexión segura (¿el certificado es válido para {host}?): {e}"))?;
                let c = imap::Client::new(tls);
                Sess::Tls(login!(c, account, creds)?)
            }
            Security::StartTls => {
                let c = imap::connect_starttls((host, sv.port), host, &connector()?).map_err(explain)?;
                Sess::Tls(login!(c, account, creds)?)
            }
            Security::None => {
                let c = imap::Client::new(tcp(host, sv.port)?);
                Sess::Plain(login!(c, account, creds)?)
            }
        };
        let mut me = Imap { s, account: account.clone(), creds: creds.clone(), has_move: false, has_uidplus: false };
        if let Ok(caps) = on!(&mut me.s, s => s.capabilities()) {
            me.has_move = caps.has_str("MOVE");
            me.has_uidplus = caps.has_str("UIDPLUS");
        }
        Ok(me)
    }

    fn select(&mut self, folder: &str) -> Result<(), String> {
        on!(&mut self.s, s => s.select(folder)).map(|_| ()).map_err(explain)
    }

    /// Quita del buzón seleccionado los mensajes marcados `\Deleted` (solo los indicados si el servidor lo permite).
    fn expunge(&mut self, set: &str) -> Result<(), String> {
        if self.has_uidplus {
            on!(&mut self.s, s => s.uid_expunge(set)).map(|_| ()).map_err(explain)
        } else {
            on!(&mut self.s, s => s.expunge()).map(|_| ()).map_err(explain)
        }
    }
}

fn set_of(keys: &[u32]) -> String {
    keys.iter().map(|u| u.to_string()).collect::<Vec<_>>().join(",")
}

impl Backend for Imap {
    fn list_folders(&mut self) -> Result<Vec<RemoteFolder>, String> {
        let names = on!(&mut self.s, s => s.list(Some(""), Some("*"))).map_err(explain)?;
        Ok(names
            .iter()
            .map(|n| {
                let delim = n.delimiter().map(|d| d.to_string());
                let path = match delim.as_deref() {
                    Some(d) if !d.is_empty() && d != "/" => n.name().replace(d, "/"),
                    _ => n.name().to_string(),
                };
                RemoteFolder { name: n.name().to_string(), path, delimiter: delim, attrs: n.attributes().iter().map(|a| format!("{a:?}")).map(|a| attr_text(&a)).collect() }
            })
            .collect())
    }

    fn folder_state(&mut self, folder: &str) -> Result<FolderState, String> {
        let mb = on!(&mut self.s, s => s.examine(folder)).map_err(explain)?;
        let mut out = FolderState { validity: mb.uid_validity.unwrap_or(0).to_string(), items: vec![], mirror_deletions: true };
        if mb.exists == 0 {
            return Ok(out);
        }
        let all = on!(&mut self.s, s => s.uid_fetch("1:*", "(UID FLAGS RFC822.SIZE)")).map_err(explain)?;
        for f in all.iter() {
            let Some(uid) = f.uid else { continue };
            out.items.push(StateItem { key: uid.to_string(), flags: f.flags().iter().map(|x| format!("{x:?}")).map(|x| attr_text(&x)).collect(), size: f.size.unwrap_or(0) });
        }
        out.items.sort_by_key(|i| std::cmp::Reverse(i.key.parse::<u32>().unwrap_or(0)));
        Ok(out)
    }

    fn fetch(&mut self, folder: &str, keys: &[String], max_bytes: u32) -> Result<Fetched, String> {
        let uids = parse_keys_u32(keys)?;
        on!(&mut self.s, s => s.examine(folder)).map_err(explain)?;
        let mut out = Fetched::default();
        for chunk in uids.chunks(25) {
            let meta = on!(&mut self.s, s => s.uid_fetch(set_of(chunk), "(UID FLAGS RFC822.SIZE)")).map_err(explain)?;
            let mut want: Vec<u32> = vec![];
            for f in meta.iter() {
                let Some(uid) = f.uid else { continue };
                let size = f.size.unwrap_or(0);
                if size > max_bytes {
                    out.skipped.push(Skipped { key: uid.to_string(), size });
                } else {
                    want.push(uid);
                }
            }
            if want.is_empty() {
                continue;
            }
            want.sort_unstable();
            let full = on!(&mut self.s, s => s.uid_fetch(set_of(&want), "(UID FLAGS BODY.PEEK[])")).map_err(explain)?;
            for f in full.iter() {
                let (Some(uid), Some(body)) = (f.uid, f.body()) else { continue };
                out.messages.push(RemoteMessage {
                    key: uid.to_string(),
                    flags: f.flags().iter().map(|x| format!("{x:?}")).map(|x| attr_text(&x)).collect(),
                    raw: base64::engine::general_purpose::STANDARD.encode(body),
                });
            }
        }
        out.messages.sort_by_key(|m| m.key.parse::<u32>().unwrap_or(0));
        Ok(out)
    }

    fn set_flag(&mut self, folder: &str, keys: &[String], flag: &str, on_: bool) -> Result<(), String> {
        let name = check_flag(flag)?;
        let uids = parse_keys_u32(keys)?;
        self.select(folder)?;
        let q = format!("{}FLAGS.SILENT ({name})", if on_ { "+" } else { "-" });
        for chunk in uids.chunks(200) {
            on!(&mut self.s, s => s.uid_store(set_of(chunk), &q)).map_err(explain)?;
        }
        Ok(())
    }

    fn move_to(&mut self, folder: &str, keys: &[String], to: &str) -> Result<(), String> {
        let uids = parse_keys_u32(keys)?;
        if folder == to {
            return Ok(());
        }
        self.select(folder)?;
        for chunk in uids.chunks(200) {
            let set = set_of(chunk);
            if self.has_move {
                on!(&mut self.s, s => s.uid_mv(&set, to)).map_err(explain)?;
            } else {
                on!(&mut self.s, s => s.uid_copy(&set, to)).map_err(explain)?;
                on!(&mut self.s, s => s.uid_store(&set, "+FLAGS.SILENT (\\Deleted)")).map_err(explain)?;
                self.expunge(&set)?;
            }
        }
        Ok(())
    }

    fn remove(&mut self, folder: &str, keys: &[String]) -> Result<(), String> {
        let uids = parse_keys_u32(keys)?;
        self.select(folder)?;
        for chunk in uids.chunks(200) {
            let set = set_of(chunk);
            on!(&mut self.s, s => s.uid_store(&set, "+FLAGS.SILENT (\\Deleted)")).map_err(explain)?;
            self.expunge(&set)?;
        }
        Ok(())
    }

    fn append(&mut self, folder: &str, raw: &[u8], seen: bool) -> Result<(), String> {
        if seen {
            on!(&mut self.s, s => s.append_with_flags(folder, raw, &[imap::types::Flag::Seen])).map_err(explain)
        } else {
            on!(&mut self.s, s => s.append(folder, raw)).map_err(explain)
        }
    }

    fn create_folder(&mut self, path: &str) -> Result<(), String> {
        // la página usa «/» entre niveles; cada servidor tiene su propio separador
        let delim = self.list_folders()?.iter().find_map(|f| f.delimiter.clone()).unwrap_or_else(|| "/".into());
        let name = path.replace('/', &delim);
        on!(&mut self.s, s => s.create(&name)).map_err(explain)
    }

    fn delete_folder(&mut self, folder: &str) -> Result<(), String> {
        on!(&mut self.s, s => s.delete(folder)).map_err(explain)
    }

    fn send(&mut self, from: &str, recipients: &[String], raw: &[u8]) -> Result<(), String> {
        smtp_client::send(&self.account, &self.creds, from, recipients, raw)
    }

    fn logout(mut self: Box<Self>) {
        let _ = on!(&mut self.s, s => s.logout());
    }
}

fn login_error(e: imap::Error, oauth: bool) -> String {
    match e {
        imap::Error::No(_) if oauth => "El servidor no aceptó el inicio de sesión con OAuth. Comprueba que el acceso IMAP está activado para la cuenta y que la aplicación tiene permiso; si hace falta, inicia sesión de nuevo.".to_string(),
        imap::Error::No(_) => "El servidor no aceptó el usuario o la contraseña. Con Gmail, iCloud o Yahoo hace falta una contraseña de aplicación (Outlook.com y Microsoft 365 piden OAuth).".to_string(),
        other => explain(other),
    }
}

/// `Custom("\\Sent")` → `\Sent`; `NoSelect` → `\NoSelect`.
fn attr_text(debug: &str) -> String {
    if let Some(inner) = debug.strip_prefix("Custom(\"").and_then(|s| s.strip_suffix("\")")) {
        return inner.replace("\\\\", "\\");
    }
    format!("\\{debug}")
}
