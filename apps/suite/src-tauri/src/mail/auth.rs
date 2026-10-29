//! OAuth 2.0 para cuentas de correo (Google, Microsoft u otro proveedor): flujo de código de autorización con PKCE y
//! redirección a este mismo equipo (RFC 7636 y RFC 8252). El inicio de sesión ocurre en el navegador del usuario; aquí solo se
//! recibe un código, se cambia por tokens y el token renovable se guarda en el almacén seguro del sistema.
//!
//! No hay ninguna aplicación registrada de SuiteNova: quien usa Nova Mail registra la suya en Google Cloud o Microsoft
//! Entra y pega su identificador de cliente (Client ID). Un identificador compartido exigiría verificación del proveedor.

use super::account::{check_url, Account, AuthKind, Protocol};
use super::http::{agent, checked};
use super::store::Secrets;
use sha2::{Digest, Sha256};
use base64::Engine;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

pub struct Endpoints {
    pub auth_url: String,
    pub token_url: String,
    pub scope: String,
    /// Nombre con el que se escribe la redirección (Microsoft solo acepta `localhost`; Google, `127.0.0.1`).
    pub redirect_host: &'static str,
    /// Parámetros extra que pide el proveedor para entregar un token renovable.
    pub extra: Vec<(&'static str, &'static str)>,
}

pub fn endpoints(account: &Account) -> Result<Endpoints, String> {
    let o = account.auth.oauth.as_ref().ok_or("Falta la configuración de OAuth.")?;
    o.validate()?;
    match o.provider.as_str() {
        "google" => {
            if !matches!(account.protocol, Protocol::Imap | Protocol::Pop3) {
                return Err("Google solo ofrece OAuth para IMAP y POP3.".into());
            }
            Ok(Endpoints {
                auth_url: "https://accounts.google.com/o/oauth2/v2/auth".into(),
                token_url: "https://oauth2.googleapis.com/token".into(),
                scope: "https://mail.google.com/".into(),
                redirect_host: "127.0.0.1",
                extra: vec![("access_type", "offline"), ("prompt", "consent")],
            })
        }
        "microsoft" => {
            let tenant = o.tenant.as_deref().filter(|t| !t.is_empty()).unwrap_or("common");
            let scope = match account.protocol {
                Protocol::Imap => "https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access",
                Protocol::Pop3 => "https://outlook.office.com/POP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access",
                Protocol::Ews => "https://outlook.office365.com/EWS.AccessAsUser.All offline_access",
                Protocol::Jmap => return Err("Microsoft no ofrece JMAP.".into()),
            };
            Ok(Endpoints {
                auth_url: format!("https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize"),
                token_url: format!("https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"),
                scope: scope.into(),
                redirect_host: "localhost",
                extra: vec![],
            })
        }
        _ => Ok(Endpoints {
            auth_url: o.auth_url.clone().unwrap_or_default(),
            token_url: o.token_url.clone().unwrap_or_default(),
            scope: o.scope.clone().unwrap_or_default(),
            redirect_host: "127.0.0.1",
            extra: vec![],
        }),
    }
}

// ------------------------------------------------------------------ utilidades

fn random_bytes(n: usize) -> Result<Vec<u8>, String> {
    let mut b = vec![0u8; n];
    getrandom::getrandom(&mut b).map_err(|e| format!("No se pudieron obtener números aleatorios seguros: {e}"))?;
    Ok(b)
}

fn b64url(b: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b)
}

pub fn pct_encode(s: &str) -> String {
    let mut o = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
            o.push(b as char);
        } else {
            o.push_str(&format!("%{b:02X}"));
        }
    }
    o
}

pub fn pct_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 2 < b.len() => {
                if let (Some(h), Some(l)) = ((b[i + 1] as char).to_digit(16), (b[i + 2] as char).to_digit(16)) {
                    out.push((h * 16 + l) as u8);
                    i += 3;
                    continue;
                }
                out.push(b'%');
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

fn query_of(target: &str) -> HashMap<String, String> {
    target.split_once('?').map(|(_, q)| q).unwrap_or("").split('&').filter_map(|kv| kv.split_once('=')).map(|(k, v)| (pct_decode(k), pct_decode(v))).collect()
}

pub fn pkce() -> Result<(String, String), String> {
    let verifier = b64url(&random_bytes(48)?);
    let challenge = b64url(&Sha256::digest(verifier.as_bytes()));
    Ok((verifier, challenge))
}

/// Con qué configuración se inició sesión por última vez en esta ejecución, por cuenta.
fn logins() -> &'static Mutex<HashMap<String, String>> {
    static L: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    L.get_or_init(|| Mutex::new(HashMap::new()))
}

fn fingerprint(a: &Account) -> String {
    format!("{:?}|{:?}|{}|{:?}", a.protocol, a.auth.oauth, a.username, a.url)
}

pub fn logged_in_with(a: &Account) -> bool {
    logins().lock().unwrap().get(&a.id).map_or(false, |f| *f == fingerprint(a))
}

fn oauth_key(id: &str) -> String {
    format!("{id}#oauth")
}
fn secret_key(id: &str) -> String {
    format!("{id}#secret")
}

fn cache() -> &'static Mutex<HashMap<String, (String, Instant)>> {
    static C: OnceLock<Mutex<HashMap<String, (String, Instant)>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Olvida los tokens de una cuenta (al quitarla o al cancelar un inicio de sesión).
pub fn forget(id: &str, secrets: &dyn Secrets) -> Result<(), String> {
    cache().lock().unwrap().remove(id);
    logins().lock().unwrap().remove(id);
    secrets.delete(&oauth_key(id))?;
    secrets.delete(&secret_key(id))
}

// ------------------------------------------------------------------ tokens

struct Tokens {
    access: String,
    refresh: Option<String>,
    expires_in: u64,
}

fn token_request(account: &Account, ep: &Endpoints, secrets: &dyn Secrets, form: Vec<(&str, String)>) -> Result<Tokens, String> {
    let o = account.auth.oauth.as_ref().ok_or("Falta la configuración de OAuth.")?;
    let url = checked("Token de OAuth", &ep.token_url)?;
    let mut form = form;
    form.push(("client_id", o.client_id.clone()));
    if let Some(s) = secrets.get(&secret_key(&account.id))? {
        form.push(("client_secret", s));
    }
    let pairs: Vec<(&str, &str)> = form.iter().map(|(k, v)| (*k, v.as_str())).collect();
    let resp = agent()?.post(&url).set("Accept", "application/json").send_form(&pairs);
    let json: serde_json::Value = match resp {
        Ok(r) => r.into_json().map_err(|_| "La respuesta del proveedor no es válida.".to_string())?,
        Err(ureq::Error::Status(_, r)) => {
            let j: serde_json::Value = r.into_json().unwrap_or_default();
            let code = j["error"].as_str().unwrap_or("");
            let desc = j["error_description"].as_str().unwrap_or("");
            return Err(match code {
                "invalid_grant" => "La sesión de OAuth caducó o fue revocada: inicia sesión de nuevo en la cuenta.".to_string(),
                "invalid_client" | "unauthorized_client" => "El proveedor no reconoce el identificador de cliente (o hace falta el secreto del cliente). Revisa el registro de la aplicación.".to_string(),
                _ => format!("El proveedor rechazó el inicio de sesión ({code}): {}", super::tls::clean(desc).chars().take(160).collect::<String>()),
            });
        }
        Err(e) => return Err(super::http::explain(e)),
    };
    let access = json["access_token"].as_str().ok_or("El proveedor no devolvió un token de acceso.")?.to_string();
    Ok(Tokens { access, refresh: json["refresh_token"].as_str().map(|s| s.to_string()), expires_in: json["expires_in"].as_u64().unwrap_or(3600) })
}

fn remember(account: &Account, secrets: &dyn Secrets, t: &Tokens) -> Result<(), String> {
    if let Some(r) = &t.refresh {
        secrets.set(&oauth_key(&account.id), r)?;
    }
    cache().lock().unwrap().insert(account.id.clone(), (t.access.clone(), Instant::now() + Duration::from_secs(t.expires_in.saturating_sub(60).max(30))));
    Ok(())
}

/// Un token de acceso válido (se renueva con el token guardado cuando está por caducar).
pub fn access_token(account: &Account, secrets: &dyn Secrets) -> Result<String, String> {
    if account.auth.kind != AuthKind::Oauth {
        return Err("La cuenta no usa OAuth.".into());
    }
    if let Some((t, until)) = cache().lock().unwrap().get(&account.id) {
        if Instant::now() < *until {
            return Ok(t.clone());
        }
    }
    let refresh = secrets.get(&oauth_key(&account.id))?.ok_or("Falta iniciar sesión: abre la configuración de la cuenta y pulsa «Iniciar sesión».")?;
    let ep = endpoints(account)?;
    let mut form = vec![("grant_type", "refresh_token".to_string()), ("refresh_token", refresh)];
    if account.auth.oauth.as_ref().map_or(false, |o| o.provider != "google") {
        form.push(("scope", ep.scope.clone()));
    }
    let t = token_request(account, &ep, secrets, form)?;
    remember(account, secrets, &t)?;
    Ok(t.access)
}

// ------------------------------------------------------------------ inicio de sesión en el navegador

const PAGE_OK: &str = "<!doctype html><meta charset=utf-8><title>Nova Mail</title><body style=\"font-family:sans-serif;margin:3em\"><h2>Listo</h2><p>Nova Mail ya tiene acceso. Puedes cerrar esta ventana y volver a la aplicación.</p></body>";
const PAGE_ERR: &str = "<!doctype html><meta charset=utf-8><title>Nova Mail</title><body style=\"font-family:sans-serif;margin:3em\"><h2>No se pudo iniciar sesión</h2><p>Vuelve a Nova Mail para ver el motivo.</p></body>";

fn respond(mut s: TcpStream, ok: bool) {
    let body = if ok { PAGE_OK } else { PAGE_ERR };
    let _ = s.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes());
}

/// Espera la redirección del navegador y devuelve el `code`. Ignora cualquier otra petición.
fn wait_for_code(listeners: &[TcpListener], state: &str, timeout: Duration) -> Result<String, String> {
    let end = Instant::now() + timeout;
    for l in listeners {
        l.set_nonblocking(true).map_err(|e| e.to_string())?;
    }
    while Instant::now() < end {
        for l in listeners {
            if let Ok((mut s, _)) = l.accept() {
                let _ = s.set_nonblocking(false);
                let _ = s.set_read_timeout(Some(Duration::from_secs(5)));
                let mut buf = [0u8; 8192];
                let n = s.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let target = req.lines().next().and_then(|l| l.strip_prefix("GET ")).and_then(|l| l.split(' ').next()).unwrap_or("").to_string();
                if !target.starts_with("/?") && !target.starts_with("/&") && target != "/" {
                    respond(s, false);
                    continue;
                }
                let q = query_of(&target);
                if q.get("state").map(String::as_str) != Some(state) {
                    respond(s, false); // una petición que no es la de esta sesión: se ignora
                    continue;
                }
                if let Some(e) = q.get("error") {
                    respond(s, false);
                    let d = q.get("error_description").map(|d| format!(": {}", super::tls::clean(d))).unwrap_or_default();
                    return Err(if e == "access_denied" { "Se canceló el inicio de sesión.".to_string() } else { format!("El proveedor devolvió un error ({}){d}", super::tls::clean(e)) });
                }
                if let Some(code) = q.get("code") {
                    respond(s, true);
                    return Ok(code.clone());
                }
                respond(s, false);
            }
        }
        std::thread::sleep(Duration::from_millis(40));
    }
    Err("Se agotó el tiempo de espera: no se completó el inicio de sesión en el navegador.".into())
}

/// Inicia sesión: abre el navegador (con `open`), espera la redirección, cambia el código por tokens y los guarda.
/// `client_secret` es solo para proveedores que lo exigen aunque la aplicación sea de escritorio (Google lo pide en algunos casos).
pub fn login(account: &Account, client_secret: Option<&str>, secrets: &dyn Secrets, open: &dyn Fn(&str) -> Result<(), String>, timeout: Duration) -> Result<(), String> {
    account.validate()?;
    let ep = endpoints(account)?;
    let o = account.auth.oauth.as_ref().ok_or("Falta la configuración de OAuth.")?;
    if let Some(s) = client_secret {
        if s.len() > 300 || s.chars().any(|c| c.is_control() || c.is_whitespace()) {
            return Err("El secreto del cliente no es válido.".into());
        }
        if !s.is_empty() {
            secrets.set(&secret_key(&account.id), s)?;
        }
    }
    let v4 = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("No se pudo abrir el puerto de retorno en este equipo: {e}"))?;
    let port = v4.local_addr().map_err(|e| e.to_string())?.port();
    let mut listeners = vec![v4];
    if let Ok(v6) = TcpListener::bind(("::1", port)) {
        listeners.push(v6);
    }
    let redirect = format!("http://{}:{port}/", ep.redirect_host);
    let state = b64url(&random_bytes(24)?);
    let (verifier, challenge) = pkce()?;
    let mut url = format!(
        "{}{}response_type=code&client_id={}&redirect_uri={}&scope={}&state={}&code_challenge={}&code_challenge_method=S256&login_hint={}",
        ep.auth_url,
        if ep.auth_url.contains('?') { "&" } else { "?" },
        pct_encode(&o.client_id),
        pct_encode(&redirect),
        pct_encode(&ep.scope),
        state,
        challenge,
        pct_encode(&account.email)
    );
    for (k, v) in &ep.extra {
        url.push_str(&format!("&{k}={v}"));
    }
    check_url("Autorización de OAuth", &ep.auth_url)?;
    open(&url)?;
    let code = wait_for_code(&listeners, &state, timeout)?;
    let t = token_request(account, &ep, secrets, vec![("grant_type", "authorization_code".into()), ("code", code), ("redirect_uri", redirect), ("code_verifier", verifier)])?;
    if t.refresh.is_none() {
        return Err("El proveedor no entregó un token renovable. Comprueba que la aplicación permite acceso sin conexión (en Google, un cliente de tipo «Aplicación de escritorio»).".into());
    }
    remember(account, secrets, &t)?;
    logins().lock().unwrap().insert(account.id.clone(), fingerprint(account));
    Ok(())
}

/// Abre una dirección en el navegador predeterminado (solo `https://`, o este equipo en pruebas).
pub fn open_browser(url: &str) -> Result<(), String> {
    check_url("Autorización de OAuth", url.split('?').next().unwrap_or(url))?;
    webbrowser::open(url).map_err(|e| format!("No se pudo abrir el navegador: {e}"))
}
