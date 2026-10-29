//! POP3 (RFC 1939): una sola carpeta (la bandeja de entrada), sin marcas en el servidor. Los mensajes se identifican con
//! UIDL. Los borrados se confirman al cerrar la sesión (QUIT), como exige el protocolo.

use super::account::{Account, Security};
use super::backend::{Backend, Creds, Fetched, FolderState, RemoteFolder, RemoteMessage, Skipped, StateItem};
use super::smtp_client;
use super::tls::{clean, connector, tcp};
use base64::Engine;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};

trait Rw: Read + Write {}
impl<T: Read + Write> Rw for T {}

const NO_FOLDERS: &str = "POP3 solo tiene la bandeja de entrada: no admite carpetas.";

pub struct Pop3 {
    io: BufReader<Box<dyn Rw>>,
    account: Account,
    creds: Creds,
    /// UIDL → número de mensaje en esta sesión, y tamaños.
    index: Option<Vec<(u32, String, u32)>>,
}

impl Pop3 {
    pub fn connect(account: &Account, creds: &Creds) -> Result<Pop3, String> {
        account.validate()?;
        let sv = &account.imap;
        let host = sv.host.trim();
        let mut greeted = false;
        let io: Box<dyn Rw> = match sv.security {
            Security::Tls => Box::new(connector()?.connect(host, tcp(host, sv.port)?).map_err(|e| format!("No se pudo establecer la conexión segura (¿el certificado es válido para {host}?): {e}"))?),
            Security::StartTls => {
                // saludo y STLS a mano, y después el resto de la sesión va cifrada
                let mut plain = tcp(host, sv.port)?;
                let mut br = BufReader::new(plain.try_clone().map_err(|e| e.to_string())?);
                let mut l = String::new();
                br.read_line(&mut l).map_err(|e| format!("Error de red: {e}"))?;
                if !l.starts_with("+OK") {
                    return Err(format!("Respuesta inesperada del servidor POP3: {}", clean(&l)));
                }
                plain.write_all(b"STLS
").map_err(|e| format!("Error de red: {e}"))?;
                l.clear();
                br.read_line(&mut l).map_err(|e| format!("Error de red: {e}"))?;
                if !l.starts_with("+OK") {
                    return Err("El servidor POP3 no admite STARTTLS: usa el puerto 995 (TLS).".into());
                }
                greeted = true;
                Box::new(connector()?.connect(host, plain).map_err(|e| format!("No se pudo establecer la conexión segura (¿el certificado es válido para {host}?): {e}"))?)
            }
            Security::None => Box::new(tcp(host, sv.port)?),
        };
        let mut me = Pop3 { io: BufReader::new(io), account: account.clone(), creds: creds.clone(), index: None };
        if !greeted {
            me.status()?;
        }
        me.login()?;
        Ok(me)
    }

    fn line(&mut self) -> Result<String, String> {
        let mut s = String::new();
        let n = self.io.read_line(&mut s).map_err(|e| format!("Error de red: {e}"))?;
        if n == 0 {
            return Err("El servidor cerró la conexión.".into());
        }
        Ok(s.trim_end_matches(['\r', '\n']).to_string())
    }

    fn send_line(&mut self, text: &str) -> Result<(), String> {
        let w = self.io.get_mut();
        w.write_all(text.as_bytes()).and_then(|_| w.write_all(b"\r\n")).and_then(|_| w.flush()).map_err(|e| format!("Error de red: {e}"))
    }

    /// Lee una respuesta de una línea: `+OK …` o `-ERR …`.
    fn status(&mut self) -> Result<String, String> {
        let l = self.line()?;
        if let Some(rest) = l.strip_prefix("+OK") {
            Ok(rest.trim().to_string())
        } else if let Some(rest) = l.strip_prefix("-ERR") {
            Err(format!("El servidor POP3 rechazó la operación: {}", clean(rest.trim())))
        } else {
            Err(format!("Respuesta inesperada del servidor POP3: {}", clean(&l)))
        }
    }

    fn cmd(&mut self, c: &str) -> Result<String, String> {
        self.send_line(c)?;
        self.status()
    }

    /// Respuesta de varias líneas (acaba en una línea con un solo punto; los puntos del inicio van duplicados).
    fn multi(&mut self, c: &str, max: usize) -> Result<Vec<u8>, String> {
        self.cmd(c)?;
        let mut out = Vec::new();
        loop {
            let mut raw = Vec::new();
            let n = self.io.read_until(b'\n', &mut raw).map_err(|e| format!("Error de red: {e}"))?;
            if n == 0 {
                return Err("El servidor cerró la conexión.".into());
            }
            if raw == b".\r\n" || raw == b".\n" {
                break;
            }
            let body = if raw.starts_with(b"..") { &raw[1..] } else { &raw[..] };
            out.extend_from_slice(body);
            if out.len() > max {
                return Err("El mensaje es demasiado grande.".into());
            }
        }
        Ok(out)
    }

    fn login(&mut self) -> Result<(), String> {
        match self.creds.clone() {
            Creds::Password(p) => {
                self.cmd(&format!("USER {}", self.account.username)).map_err(|_| auth_error(false))?;
                self.cmd(&format!("PASS {p}")).map_err(|_| auth_error(false))?;
            }
            Creds::Token(t) => {
                let blob = base64::engine::general_purpose::STANDARD.encode(format!("user={}\x01auth=Bearer {}\x01\x01", self.account.username, t));
                self.send_line(&format!("AUTH XOAUTH2 {blob}"))?;
                let l = self.line()?;
                if l.starts_with('+') && !l.starts_with("+OK") {
                    // aviso de error del servidor: se contesta vacío para cerrar el intercambio
                    self.send_line("")?;
                    let _ = self.line();
                    return Err(auth_error(true));
                }
                if !l.starts_with("+OK") {
                    return Err(auth_error(true));
                }
            }
        }
        Ok(())
    }

    fn load_index(&mut self) -> Result<&Vec<(u32, String, u32)>, String> {
        if self.index.is_none() {
            let uidl = String::from_utf8_lossy(&self.multi("UIDL", 50 * 1024 * 1024)?).to_string();
            let list = String::from_utf8_lossy(&self.multi("LIST", 50 * 1024 * 1024)?).to_string();
            let sizes: HashMap<u32, u32> = list.lines().filter_map(|l| l.split_once(' ')).filter_map(|(a, b)| Some((a.trim().parse().ok()?, b.trim().parse().ok()?))).collect();
            let mut v = vec![];
            for l in uidl.lines() {
                let Some((n, id)) = l.split_once(' ') else { continue };
                let Ok(n) = n.trim().parse::<u32>() else { continue };
                let id = id.trim();
                if id.is_empty() || id.len() > 70 || !id.bytes().all(|b| (0x21..=0x7e).contains(&b)) {
                    continue;
                }
                v.push((n, id.to_string(), sizes.get(&n).copied().unwrap_or(0)));
            }
            self.index = Some(v);
        }
        Ok(self.index.as_ref().unwrap())
    }

    fn number_of(&mut self, key: &str) -> Result<u32, String> {
        self.load_index()?.iter().find(|(_, id, _)| id == key).map(|(n, _, _)| *n).ok_or_else(|| "El mensaje ya no está en el servidor.".to_string())
    }
}

fn auth_error(oauth: bool) -> String {
    if oauth {
        "El servidor POP3 no aceptó el inicio de sesión con OAuth. Comprueba que el acceso POP está activado para la cuenta y que la aplicación tiene permiso.".into()
    } else {
        "El servidor no aceptó el usuario o la contraseña. Con Gmail, iCloud o Yahoo hace falta una contraseña de aplicación (Outlook.com y Microsoft 365 piden OAuth).".into()
    }
}

impl Backend for Pop3 {
    fn list_folders(&mut self) -> Result<Vec<RemoteFolder>, String> {
        Ok(vec![RemoteFolder { name: "INBOX".into(), path: "INBOX".into(), delimiter: None, attrs: vec![] }])
    }

    fn folder_state(&mut self, folder: &str) -> Result<FolderState, String> {
        if folder != "INBOX" {
            return Err(NO_FOLDERS.into());
        }
        let mut items: Vec<StateItem> = self.load_index()?.iter().map(|(_, id, size)| StateItem { key: id.clone(), flags: vec![], size: *size }).collect();
        items.reverse(); // el servidor las numera de más antigua a más nueva
        Ok(FolderState { validity: "pop3".into(), items, mirror_deletions: false })
    }

    fn fetch(&mut self, folder: &str, keys: &[String], max_bytes: u32) -> Result<Fetched, String> {
        if folder != "INBOX" {
            return Err(NO_FOLDERS.into());
        }
        let mut out = Fetched::default();
        for k in keys {
            let size = self.load_index()?.iter().find(|(_, id, _)| id == k).map(|(_, _, s)| *s).unwrap_or(0);
            if size > max_bytes {
                out.skipped.push(Skipped { key: k.clone(), size });
                continue;
            }
            let n = self.number_of(k)?;
            let raw = self.multi(&format!("RETR {n}"), max_bytes as usize + 1024)?;
            out.messages.push(RemoteMessage { key: k.clone(), flags: vec![], raw: base64::engine::general_purpose::STANDARD.encode(raw) });
        }
        Ok(out)
    }

    /// POP3 no guarda marcas en el servidor: se conservan solo aquí.
    fn set_flag(&mut self, _folder: &str, _keys: &[String], _flag: &str, _on: bool) -> Result<(), String> {
        Ok(())
    }

    fn move_to(&mut self, _folder: &str, _keys: &[String], _to: &str) -> Result<(), String> {
        Err(NO_FOLDERS.into())
    }

    fn remove(&mut self, folder: &str, keys: &[String]) -> Result<(), String> {
        if folder != "INBOX" {
            return Err(NO_FOLDERS.into());
        }
        for k in keys {
            let n = self.number_of(k)?;
            self.cmd(&format!("DELE {n}"))?;
        }
        Ok(())
    }

    fn append(&mut self, _folder: &str, _raw: &[u8], _seen: bool) -> Result<(), String> {
        Err(NO_FOLDERS.into())
    }
    fn create_folder(&mut self, _path: &str) -> Result<(), String> {
        Err(NO_FOLDERS.into())
    }
    fn delete_folder(&mut self, _folder: &str) -> Result<(), String> {
        Err(NO_FOLDERS.into())
    }

    fn send(&mut self, from: &str, recipients: &[String], raw: &[u8]) -> Result<(), String> {
        smtp_client::send(&self.account, &self.creds, from, recipients, raw)
    }

    /// QUIT confirma los borrados pedidos con DELE.
    fn logout(mut self: Box<Self>) {
        let _ = self.cmd("QUIT");
    }
}
