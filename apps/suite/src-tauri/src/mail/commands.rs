use super::account::{Account, AuthKind, Protocol};
use super::auth;
use super::backend::{self, Backend, Creds, Fetched, FolderState, RemoteFolder};
use super::smtp_client;
use super::store::{Accounts, Secrets, SystemSecrets};
use base64::Engine;
use std::time::Duration;
use tauri::{AppHandle, Manager};

fn accounts(app: &AppHandle) -> Result<Accounts, String> {
    let dir = app.path().app_data_dir().map_err(|e| format!("No se encontró la carpeta de datos: {e}"))?;
    Ok(Accounts::new(&dir))
}

/// Con qué se inicia sesión en una cuenta guardada: su contraseña, o un token de OAuth (renovado si hace falta).
pub fn creds_for(account: &Account, secrets: &dyn Secrets) -> Result<Creds, String> {
    match account.auth.kind {
        AuthKind::Token => secrets.get(&account.id)?.map(Creds::Token).ok_or_else(|| "No hay token guardado para esta cuenta. Vuelve a escribirlo en la configuración de la cuenta.".to_string()),
        AuthKind::Password => secrets.get(&account.id)?.map(Creds::Password).ok_or_else(|| "No hay contraseña guardada para esta cuenta. Vuelve a escribirla en la configuración de la cuenta.".to_string()),
        AuthKind::Oauth => auth::access_token(account, secrets).map(Creds::Token),
    }
}

fn decode(raw: &str) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::STANDARD.decode(raw).map_err(|_| "El mensaje no es válido.".to_string())
}

/// Las operaciones de red bloquean: se hacen fuera del hilo principal.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| format!("La operación se interrumpió: {e}"))?
}

/// Abre la conexión de una cuenta guardada, hace algo con ella y la cierra.
async fn with_backend<T: Send + 'static>(app: &AppHandle, id: String, f: impl FnOnce(&mut dyn Backend) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    let account = accounts(app)?.get(&id)?;
    blocking(move || {
        let creds = creds_for(&account, &SystemSecrets)?;
        let mut b = backend::connect(&account, &creds)?;
        let r = f(b.as_mut());
        b.logout();
        r
    })
    .await
}

#[tauri::command]
pub fn mail_accounts(app: AppHandle) -> Result<Vec<Account>, String> {
    accounts(&app)?.list()
}

/// Guarda una cuenta. Con `password` se guarda también la contraseña (obligatoria al crear o al cambiar de servidor).
/// Las cuentas con OAuth no llevan contraseña: antes hay que haber iniciado sesión con `mail_oauth_login`.
#[tauri::command]
pub fn mail_account_save(app: AppHandle, account: Account, password: Option<String>) -> Result<(), String> {
    accounts(&app)?.save(account, password.as_deref(), &SystemSecrets)
}

#[tauri::command]
pub fn mail_account_remove(app: AppHandle, id: String) -> Result<(), String> {
    accounts(&app)?.remove(&id, &SystemSecrets)
}

/// Inicia sesión con OAuth: abre el navegador y espera (hasta 3 minutos) a que el usuario termine.
/// `client_secret` solo se necesita con proveedores que lo exigen incluso en aplicaciones de escritorio.
#[tauri::command]
pub async fn mail_oauth_login(account: Account, client_secret: Option<String>) -> Result<(), String> {
    blocking(move || auth::login(&account, client_secret.as_deref(), &SystemSecrets, &auth::open_browser, Duration::from_secs(180))).await
}

/// Descarta lo guardado de un inicio de sesión que no llegó a guardarse como cuenta.
#[tauri::command]
pub fn mail_oauth_forget(app: AppHandle, id: String) -> Result<(), String> {
    if accounts(&app)?.list()?.iter().any(|a| a.id == id) {
        return Err("La cuenta está guardada: quítala desde la lista de cuentas.".into());
    }
    auth::forget(&id, &SystemSecrets)
}

/// Prueba una configuración (con la contraseña escrita ahora, la ya guardada o el inicio de sesión de OAuth) sin guardar nada.
/// Solo se usa la contraseña guardada si el destino no cambió respecto de la cuenta guardada.
#[tauri::command]
pub async fn mail_test(app: AppHandle, account: Account, password: Option<String>) -> Result<(), String> {
    account.validate()?;
    let store = accounts(&app)?;
    let creds = match (account.auth.kind, password) {
        (AuthKind::Password, Some(p)) if !p.is_empty() => Creds::Password(p),
        (AuthKind::Token, Some(p)) if !p.is_empty() => Creds::Token(p),
        (AuthKind::Password | AuthKind::Token, _) => {
            let saved = store.get(&account.id).map_err(|_| "Escribe la contraseña para probar este servidor.".to_string())?;
            if saved.changes_destination(&account) {
                return Err("Escribe la contraseña para probar este servidor.".into());
            }
            blocking({
                let saved = saved.clone();
                move || creds_for(&saved, &SystemSecrets)
            })
            .await?
        }
        (AuthKind::Oauth, _) => {
            if !auth::logged_in_with(&account) && store.get(&account.id).map_or(true, |s| s.changes_destination(&account)) {
                return Err("Inicia sesión con el proveedor para probar la cuenta.".into());
            }
            let acc = account.clone();
            Creds::Token(blocking(move || auth::access_token(&acc, &SystemSecrets)).await?)
        }
    };
    blocking(move || {
        let mut b = backend::connect(&account, &creds)?;
        let r = b.list_folders().map(|_| ());
        b.logout();
        r?;
        if matches!(account.protocol, Protocol::Imap | Protocol::Pop3) {
            smtp_client::test(&account, &creds)?;
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn mail_list_folders(app: AppHandle, id: String) -> Result<Vec<RemoteFolder>, String> {
    with_backend(&app, id, |b| b.list_folders()).await
}

#[tauri::command]
pub async fn mail_folder_state(app: AppHandle, id: String, folder: String) -> Result<FolderState, String> {
    with_backend(&app, id, move |b| b.folder_state(&folder)).await
}

#[tauri::command]
pub async fn mail_fetch(app: AppHandle, id: String, folder: String, keys: Vec<String>, max_bytes: u32) -> Result<Fetched, String> {
    with_backend(&app, id, move |b| b.fetch(&folder, &keys, max_bytes.clamp(1024, 100 * 1024 * 1024))).await
}

#[tauri::command]
pub async fn mail_set_flag(app: AppHandle, id: String, folder: String, keys: Vec<String>, flag: String, on: bool) -> Result<(), String> {
    with_backend(&app, id, move |b| b.set_flag(&folder, &keys, &flag, on)).await
}

#[tauri::command]
pub async fn mail_move(app: AppHandle, id: String, folder: String, keys: Vec<String>, to: String) -> Result<(), String> {
    with_backend(&app, id, move |b| b.move_to(&folder, &keys, &to)).await
}

/// Borra para siempre del servidor.
#[tauri::command]
pub async fn mail_remove(app: AppHandle, id: String, folder: String, keys: Vec<String>) -> Result<(), String> {
    with_backend(&app, id, move |b| b.remove(&folder, &keys)).await
}

#[tauri::command]
pub async fn mail_append(app: AppHandle, id: String, folder: String, raw: String, seen: bool) -> Result<(), String> {
    let bytes = decode(&raw)?;
    if bytes.len() > 40 * 1024 * 1024 {
        return Err("El mensaje es demasiado grande (más de 40 MB).".into());
    }
    with_backend(&app, id, move |b| b.append(&folder, &bytes, seen)).await
}

#[tauri::command]
pub async fn mail_create_folder(app: AppHandle, id: String, path: String) -> Result<(), String> {
    if path.is_empty() || path.len() > 500 || path.chars().any(|c| c.is_control()) {
        return Err("El nombre de la carpeta no es válido.".into());
    }
    with_backend(&app, id, move |b| b.create_folder(&path)).await
}

#[tauri::command]
pub async fn mail_delete_folder(app: AppHandle, id: String, folder: String) -> Result<(), String> {
    with_backend(&app, id, move |b| b.delete_folder(&folder)).await
}

#[tauri::command]
pub async fn mail_send(app: AppHandle, id: String, recipients: Vec<String>, raw: String) -> Result<(), String> {
    let account = accounts(&app)?.get(&id)?;
    let bytes = decode(&raw)?;
    if recipients.is_empty() {
        return Err("Falta algún destinatario.".into());
    }
    if recipients.len() > 200 {
        return Err("Demasiados destinatarios.".into());
    }
    if bytes.len() > 40 * 1024 * 1024 {
        return Err("El mensaje es demasiado grande (más de 40 MB).".into());
    }
    // el remitente del sobre es siempre la dirección de la cuenta: nadie puede enviar «como» otra persona
    let from = account.email.clone();
    blocking(move || {
        let creds = creds_for(&account, &SystemSecrets)?;
        // con IMAP y POP3 el envío va por SMTP sin abrir el buzón; con JMAP y Exchange es el mismo servicio
        if matches!(account.protocol, Protocol::Imap | Protocol::Pop3) {
            return smtp_client::send(&account, &creds, &from, &recipients, &bytes);
        }
        let mut b = backend::connect(&account, &creds)?;
        let r = b.send(&from, &recipients, &bytes);
        b.logout();
        r
    })
    .await
}
