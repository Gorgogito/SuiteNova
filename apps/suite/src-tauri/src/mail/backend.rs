//! Lo común a todos los protocolos (IMAP, POP3, JMAP y Exchange): qué datos se intercambian con la página y cómo se
//! abre una conexión. La página trabaja siempre igual: lista las carpetas, pide el estado de una (qué mensajes hay y con
//! qué marcas), baja los que faltan y manda los cambios (marcas, mover, borrar, copiar a Enviados).

use super::account::{Account, Protocol};
use serde::Serialize;

/// Con qué se inicia sesión: una contraseña o un token de acceso de OAuth (ya renovado si hacía falta).
#[derive(Clone)]
pub enum Creds {
    Password(String),
    Token(String),
}

impl Creds {
    pub fn secret(&self) -> &str {
        match self {
            Creds::Password(p) | Creds::Token(p) => p,
        }
    }
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct RemoteFolder {
    /// Lo que se pasa a las demás órdenes: en IMAP el nombre; en JMAP y Exchange un identificador.
    pub name: String,
    /// Ruta legible con `/` entre niveles (`Trabajo/Proyecto A`).
    pub path: String,
    pub delimiter: Option<String>,
    /// Atributos como `\Sent`, `\Drafts`, `\Noselect`…
    pub attrs: Vec<String>,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct StateItem {
    /// Identificador del mensaje en la carpeta (en IMAP, el UID).
    pub key: String,
    pub flags: Vec<String>,
    pub size: u32,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq, Default)]
pub struct FolderState {
    /// Cambia cuando el servidor renumera la carpeta (IMAP: UIDVALIDITY); los identificadores anteriores ya no valen.
    pub validity: String,
    /// De más nuevo a más antiguo.
    pub items: Vec<StateItem>,
    /// Si un mensaje que ya no está en el servidor debe quitarse también de aquí (no en POP3, donde se descarga y se conserva).
    pub mirror_deletions: bool,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct RemoteMessage {
    pub key: String,
    pub flags: Vec<String>,
    /// El mensaje tal como llegó, en base64.
    pub raw: String,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct Skipped {
    pub key: String,
    pub size: u32,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq, Default)]
pub struct Fetched {
    pub messages: Vec<RemoteMessage>,
    /// Mensajes que superan el tamaño máximo y no se descargaron.
    pub skipped: Vec<Skipped>,
}

pub trait Backend {
    fn list_folders(&mut self) -> Result<Vec<RemoteFolder>, String>;
    fn folder_state(&mut self, folder: &str) -> Result<FolderState, String>;
    fn fetch(&mut self, folder: &str, keys: &[String], max_bytes: u32) -> Result<Fetched, String>;
    /// Solo `\Seen`, `\Flagged` y `\Answered`.
    fn set_flag(&mut self, folder: &str, keys: &[String], flag: &str, on: bool) -> Result<(), String>;
    fn move_to(&mut self, folder: &str, keys: &[String], to: &str) -> Result<(), String>;
    /// Borra para siempre del servidor.
    fn remove(&mut self, folder: &str, keys: &[String]) -> Result<(), String>;
    fn append(&mut self, folder: &str, raw: &[u8], seen: bool) -> Result<(), String>;
    fn create_folder(&mut self, path: &str) -> Result<(), String>;
    fn delete_folder(&mut self, folder: &str) -> Result<(), String>;
    /// Envía un mensaje ya construido. `from` es siempre la dirección de la cuenta.
    fn send(&mut self, from: &str, recipients: &[String], raw: &[u8]) -> Result<(), String>;
    fn logout(self: Box<Self>);
}

pub fn check_flag(flag: &str) -> Result<&str, String> {
    match flag {
        "\\Seen" | "\\Flagged" | "\\Answered" => Ok(flag),
        _ => Err("Esa marca no se puede cambiar.".into()),
    }
}

pub fn parse_keys_u32(keys: &[String]) -> Result<Vec<u32>, String> {
    if keys.is_empty() || keys.len() > 5000 {
        return Err("Hay que indicar entre 1 y 5000 mensajes.".into());
    }
    keys.iter().map(|k| k.parse::<u32>().map_err(|_| "El identificador del mensaje no es válido.".to_string())).collect()
}

/// Abre la conexión que corresponde al protocolo de la cuenta.
pub fn connect(account: &Account, creds: &Creds) -> Result<Box<dyn Backend>, String> {
    account.validate()?;
    match account.protocol {
        Protocol::Imap => Ok(Box::new(super::imap_client::Imap::connect(account, creds)?)),
        Protocol::Pop3 => Ok(Box::new(super::pop3_client::Pop3::connect(account, creds)?)),
        Protocol::Jmap => Ok(Box::new(super::jmap_client::Jmap::connect(account, creds)?)),
        Protocol::Ews => Ok(Box::new(super::ews_client::Ews::connect(account, creds)?)),
    }
}
