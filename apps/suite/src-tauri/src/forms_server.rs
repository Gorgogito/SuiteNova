//! Recoger respuestas de Nova Forms por la red local.
//!
//! Mientras la persona lo tiene encendido, el programa escucha en **una** dirección de este equipo (de la red local, o
//! 127.0.0.1) y solo entrega dos cosas que tiene en memoria: la página del formulario y, a quien ya respondió, una
//! página que lo dice. Recibe las respuestas y se las pasa a la ventana que lo encendió, que es quien decide si son
//! válidas. **No lee ni escribe ningún archivo.**
//!
//! Defensas: la dirección lleva una clave al azar; solo se atiende a direcciones privadas (nunca de internet), con la
//! cabecera `Host` exacta (contra el cambio de DNS) y, al enviar, sin otro origen; hay límites de tamaño, de tiempo, de
//! conexiones y de envíos por minuto. **No hay cifrado:** quien comparta la red puede ver lo que viaja.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, Shutdown, SocketAddr, SocketAddrV4, TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::{Arc, Mutex, MutexGuard, RwLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

/// El primer puerto que se intenta (y los nueve siguientes), para que la dirección cambie poco de una vez a otra.
const FIRST_PORT: u16 = 8765;
/// Más que esto no pesa ninguna página ni respuesta de las que la aplicación puede pedir.
const MOST_BODY: usize = 48 * 1024 * 1024;
const MB: usize = 1024 * 1024;

#[derive(Clone, Copy)]
pub struct Limits {
    /// Bytes de la línea de petición y las cabeceras.
    pub head: usize,
    /// Conexiones a la vez, en total y de una misma dirección.
    pub connections: usize,
    pub per_address: usize,
    /// Respuestas que una dirección puede enviar en un minuto.
    pub posts_per_minute: usize,
    /// Respuestas de más de 1 MB recibiéndose a la vez.
    pub large: usize,
    /// Tiempo para las cabeceras, para el cuerpo, y para que la aplicación conteste.
    pub head_time: Duration,
    pub body_time: Duration,
    pub answer_time: Duration,
}

impl Default for Limits {
    fn default() -> Self {
        Limits { head: 8 * 1024, connections: 64, per_address: 12, posts_per_minute: 30, large: 4, head_time: Duration::from_secs(10), body_time: Duration::from_secs(150), answer_time: Duration::from_secs(60) }
    }
}

/// Lo que se sirve. La aplicación lo cambia cuando cambia el formulario.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Content {
    /// La página del formulario y la de quien ya respondió.
    pub page: String,
    pub answered: String,
    /// Identificador del formulario, para recordar quién ya respondió.
    pub key: String,
    /// Una sola respuesta por navegador (se anota con una cookie: quien la borre puede volver a responder).
    pub once: bool,
    /// Lo más que puede pesar una respuesta, en bytes.
    pub max_body: usize,
}

struct Reply {
    ok: bool,
    message: String,
}

/// Avisa de que ha llegado la respuesta con ese número. Falso si no hay a quién avisar.
type Sink = Box<dyn Fn(u64) -> bool + Send + Sync>;

struct Shared {
    token: String,
    host: String,
    content: RwLock<Content>,
    bodies: Mutex<HashMap<u64, String>>,
    waiting: Mutex<HashMap<u64, SyncSender<Reply>>>,
    next: AtomicU64,
    open: Mutex<HashMap<IpAddr, usize>>,
    recent: Mutex<HashMap<IpAddr, VecDeque<Instant>>>,
    large: AtomicUsize,
    stop: AtomicBool,
    sink: Sink,
    limits: Limits,
}

/// Un cerrojo envenenado (un hilo que falló con él puesto) no debe parar a los demás.
fn locked<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

pub struct Server {
    shared: Arc<Shared>,
    /// Dónde escucha (las pruebas se conectan ahí).
    #[cfg_attr(not(test), allow(dead_code))]
    pub address: SocketAddr,
    thread: Option<JoinHandle<()>>,
}

/// Solo este equipo y las redes privadas.
fn is_local(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(a) => a.is_loopback() || a.is_private() || a.is_link_local(),
        IpAddr::V6(a) => a.is_loopback(),
    }
}

fn token() -> Result<String, String> {
    let mut bytes = [0u8; 10];
    getrandom::getrandom(&mut bytes).map_err(|e| format!("No se pudo crear la clave de la dirección: {e}"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

impl Server {
    pub fn start(ip: Ipv4Addr, port: Option<u16>, content: Content, limits: Limits, sink: Sink) -> Result<Server, String> {
        if !is_local(IpAddr::V4(ip)) {
            return Err("Solo se puede recoger en una dirección de la red local.".into());
        }
        check(&content)?;
        let ports: Vec<u16> = match port {
            Some(p) => vec![p],
            None => (FIRST_PORT..FIRST_PORT + 10).chain([0]).collect(),
        };
        let listener = ports.iter().find_map(|p| TcpListener::bind(SocketAddrV4::new(ip, *p)).ok()).ok_or_else(|| format!("No se pudo abrir un puerto en {ip}. Comprueba que la dirección siga siendo de este equipo."))?;
        let address = listener.local_addr().map_err(|e| e.to_string())?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let shared = Arc::new(Shared {
            token: token()?,
            host: address.to_string(),
            content: RwLock::new(content),
            bodies: Default::default(),
            waiting: Default::default(),
            next: AtomicU64::new(1),
            open: Default::default(),
            recent: Default::default(),
            large: AtomicUsize::new(0),
            stop: AtomicBool::new(false),
            sink,
            limits,
        });
        let s = shared.clone();
        let thread = std::thread::spawn(move || accept(listener, s));
        Ok(Server { shared, address, thread: Some(thread) })
    }

    pub fn url(&self) -> String {
        format!("http://{}/{}", self.shared.host, self.shared.token)
    }

    pub fn update(&self, content: Content) -> Result<(), String> {
        check(&content)?;
        *self.shared.content.write().unwrap_or_else(|e| e.into_inner()) = content;
        Ok(())
    }

    /// El texto de una respuesta que llegó; solo se entrega una vez.
    pub fn take(&self, id: u64) -> Option<String> {
        locked(&self.shared.bodies).remove(&id)
    }

    /// Lo que se contesta a quien envió esa respuesta.
    pub fn reply(&self, id: u64, ok: bool, message: String) {
        if let Some(to) = locked(&self.shared.waiting).remove(&id) {
            let _ = to.try_send(Reply { ok, message });
        }
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.shared.stop.store(true, Ordering::SeqCst);
        // quienes esperaban se enteran de que ya no habrá respuesta
        locked(&self.shared.waiting).clear();
        locked(&self.shared.bodies).clear();
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

fn check(c: &Content) -> Result<(), String> {
    if c.max_body == 0 || c.max_body > MOST_BODY || c.page.len() > MOST_BODY || c.answered.len() > MB {
        return Err("El formulario es demasiado grande para servirlo.".into());
    }
    Ok(())
}

fn accept(listener: TcpListener, shared: Arc<Shared>) {
    while !shared.stop.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, peer)) => {
                let ip = peer.ip();
                if !is_local(ip) {
                    continue;
                }
                {
                    let mut open = locked(&shared.open);
                    if open.values().sum::<usize>() >= shared.limits.connections || open.get(&ip).copied().unwrap_or(0) >= shared.limits.per_address {
                        continue;
                    }
                    *open.entry(ip).or_insert(0) += 1;
                }
                let s = shared.clone();
                std::thread::spawn(move || {
                    // en Windows la conexión hereda el modo sin espera de quien escucha
                    if stream.set_nonblocking(false).is_ok() && stream.set_write_timeout(Some(Duration::from_secs(30))).is_ok() {
                        serve(stream, ip, &s);
                    }
                    let mut open = locked(&s.open);
                    if let Some(n) = open.get_mut(&ip) {
                        *n -= 1;
                        if *n == 0 {
                            open.remove(&ip);
                        }
                    }
                });
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(30)),
            Err(_) => std::thread::sleep(Duration::from_millis(100)),
        }
    }
}

#[derive(Debug)]
struct Head {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    /// Lo que ya se leyó del cuerpo.
    rest: Vec<u8>,
}

impl Head {
    /// La cabecera, si está una sola vez. `Err` si se repite.
    fn one(&self, name: &str) -> Result<Option<&str>, ()> {
        let mut found = self.headers.iter().filter(|(n, _)| n.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str());
        let first = found.next();
        if found.next().is_some() {
            return Err(());
        }
        Ok(first)
    }
}

/// Lee lo que haya, sin pasar del momento límite ni de la orden de parar.
fn read_some(stream: &mut TcpStream, into: &mut [u8], deadline: Instant, shared: &Shared) -> Option<usize> {
    loop {
        let left = deadline.checked_duration_since(Instant::now()).filter(|d| !d.is_zero())?;
        if shared.stop.load(Ordering::SeqCst) {
            return None;
        }
        // a ratos cortos, para atender la orden de parar
        stream.set_read_timeout(Some(left.min(Duration::from_millis(500)))).ok()?;
        match stream.read(into) {
            Ok(0) => return None,
            Ok(n) => return Some(n),
            Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut | std::io::ErrorKind::Interrupted) => continue,
            Err(_) => return None,
        }
    }
}

fn read_head(stream: &mut TcpStream, shared: &Shared) -> Result<Head, Option<u16>> {
    let deadline = Instant::now() + shared.limits.head_time;
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 2048];
    loop {
        let n = read_some(stream, &mut chunk, deadline, shared).ok_or(None)?;
        buffer.extend_from_slice(&chunk[..n]);
        let mut headers = [httparse::EMPTY_HEADER; 48];
        let mut request = httparse::Request::new(&mut headers);
        match request.parse(&buffer) {
            Ok(httparse::Status::Complete(end)) => {
                if end > shared.limits.head {
                    return Err(Some(431));
                }
                let method = request.method.unwrap_or("").to_string();
                let path = request.path.unwrap_or("").split(['?', '#']).next().unwrap_or("").to_string();
                let headers = request.headers.iter().map(|h| (h.name.to_string(), String::from_utf8_lossy(h.value).trim().to_string())).collect();
                return Ok(Head { method, path, headers, rest: buffer[end..].to_vec() });
            }
            Ok(httparse::Status::Partial) if buffer.len() <= shared.limits.head => continue,
            Ok(httparse::Status::Partial) | Err(httparse::Error::TooManyHeaders) => return Err(Some(431)),
            Err(_) => return Err(Some(400)),
        }
    }
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        409 => "Conflict",
        411 => "Length Required",
        413 => "Content Too Large",
        415 => "Unsupported Media Type",
        422 => "Unprocessable Content",
        429 => "Too Many Requests",
        431 => "Request Header Fields Too Large",
        _ => "Service Unavailable",
    }
}

fn respond(stream: &mut TcpStream, status: u16, kind: &str, body: &[u8], extra: &str, head_only: bool) {
    let head = format!(
        "HTTP/1.1 {status} {}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nX-Frame-Options: DENY\r\n{extra}Connection: close\r\n\r\n",
        reason(status),
        body.len()
    );
    if stream.write_all(head.as_bytes()).is_ok() && !head_only {
        let _ = stream.write_all(body);
    }
    let _ = stream.flush();
}

/// Cierra sin cortar: si quedan bytes sin leer, cerrar de golpe haría que quien envía no llegue a ver la contestación.
fn goodbye(mut stream: TcpStream) {
    let _ = stream.shutdown(Shutdown::Write);
    let _ = stream.set_read_timeout(Some(Duration::from_millis(300)));
    let until = Instant::now() + Duration::from_secs(5);
    let mut sink = [0u8; 16 * 1024];
    let mut total = 0;
    while total < MOST_BODY && Instant::now() < until {
        match stream.read(&mut sink) {
            Ok(n) if n > 0 => total += n,
            _ => break,
        }
    }
}

fn json(stream: &mut TcpStream, status: u16, message: Option<&str>, extra: &str) {
    let body = match message {
        Some(m) => serde_json::json!({ "ok": status == 200, "message": m }),
        None => serde_json::json!({ "ok": status == 200 }),
    };
    respond(stream, status, "application/json; charset=utf-8", body.to_string().as_bytes(), extra, false);
}

/// El nombre de la cookie con la que se recuerda que un navegador ya respondió a un formulario.
fn cookie_name(key: &str) -> String {
    format!("nv_done_{}", key.chars().filter(|c| c.is_ascii_alphanumeric()).take(60).collect::<String>())
}

fn answered_already(head: &Head, content: &Content) -> bool {
    let wanted = format!("{}=1", cookie_name(&content.key));
    content.once && head.headers.iter().filter(|(n, _)| n.eq_ignore_ascii_case("cookie")).any(|(_, v)| v.split(';').any(|c| c.trim() == wanted))
}

fn serve(mut stream: TcpStream, ip: IpAddr, shared: &Shared) {
    let head = match read_head(&mut stream, shared) {
        Ok(h) => h,
        Err(Some(status)) => {
            json(&mut stream, status, None, "");
            return goodbye(stream);
        }
        Err(None) => return,
    };
    handle(&mut stream, head, ip, shared);
    goodbye(stream);
}

fn handle(stream: &mut TcpStream, head: Head, ip: IpAddr, shared: &Shared) {
    let not_found = |stream: &mut TcpStream| respond(stream, 404, "text/plain; charset=utf-8", b"404", "", head.method == "HEAD");
    // quien llega por un nombre que no es esta dirección (cambio de DNS) no recibe nada
    if !matches!(head.one("host"), Ok(Some(h)) if h == shared.host) {
        return respond(stream, 403, "text/plain; charset=utf-8", b"403", "", head.method == "HEAD");
    }
    let Some(inside) = head.path.strip_prefix('/').and_then(|p| p.strip_prefix(shared.token.as_str())) else {
        return not_found(stream);
    };
    match (inside, head.method.as_str()) {
        ("" | "/", "GET" | "HEAD") => {
            let content = shared.content.read().unwrap_or_else(|e| e.into_inner()).clone();
            let page = if answered_already(&head, &content) { &content.answered } else { &content.page };
            respond(stream, 200, "text/html; charset=utf-8", page.as_bytes(), "", head.method == "HEAD");
        }
        ("/r", "POST") => receive(stream, &head, ip, shared),
        ("" | "/" | "/r", _) => json(stream, 405, None, ""),
        _ => not_found(stream),
    }
}

/// Guarda el sitio de una respuesta grande mientras se recibe.
struct Large<'a>(&'a AtomicUsize);
impl Drop for Large<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

fn receive(stream: &mut TcpStream, head: &Head, ip: IpAddr, shared: &Shared) {
    // otra página no puede enviar desde el navegador de quien está en la red
    match head.one("origin") {
        Ok(None) => {}
        Ok(Some(o)) if o == format!("http://{}", shared.host) => {}
        _ => return json(stream, 403, None, ""),
    }
    if !matches!(head.one("content-type"), Ok(Some(t)) if t.split(';').next().is_some_and(|t| t.trim().eq_ignore_ascii_case("application/json"))) {
        return json(stream, 415, None, "");
    }
    if !matches!(head.one("transfer-encoding"), Ok(None)) {
        return json(stream, 400, None, "");
    }
    let length = match head.one("content-length") {
        Ok(Some(v)) if !v.is_empty() && v.bytes().all(|b| b.is_ascii_digit()) => v.parse::<usize>().unwrap_or(usize::MAX),
        Ok(None) => return json(stream, 411, None, ""),
        _ => return json(stream, 400, None, ""),
    };
    let content = shared.content.read().unwrap_or_else(|e| e.into_inner()).clone();
    if answered_already(head, &content) {
        return json(stream, 409, None, "");
    }
    {
        let mut recent = locked(&shared.recent);
        let times = recent.entry(ip).or_default();
        while times.front().is_some_and(|t| t.elapsed() > Duration::from_secs(60)) {
            times.pop_front();
        }
        if times.len() >= shared.limits.posts_per_minute {
            return json(stream, 429, None, "");
        }
        times.push_back(Instant::now());
    }
    if length > content.max_body {
        return json(stream, 413, None, "");
    }
    let _large = if length > MB {
        if shared.large.fetch_add(1, Ordering::SeqCst) >= shared.limits.large {
            shared.large.fetch_sub(1, Ordering::SeqCst);
            return json(stream, 503, None, "");
        }
        Some(Large(&shared.large))
    } else {
        None
    };
    let deadline = Instant::now() + shared.limits.body_time;
    // crece con lo que llega: lo que se anuncia no reserva memoria
    let mut body = head.rest[..head.rest.len().min(length)].to_vec();
    let mut chunk = vec![0u8; 64 * 1024];
    while body.len() < length {
        let want = (length - body.len()).min(chunk.len());
        match read_some(stream, &mut chunk[..want], deadline, shared) {
            Some(n) => body.extend_from_slice(&chunk[..n]),
            None => return,
        }
    }
    let Ok(text) = String::from_utf8(body) else {
        return json(stream, 400, None, "");
    };
    let id = shared.next.fetch_add(1, Ordering::SeqCst);
    let (to, from) = sync_channel(1);
    {
        let mut waiting = locked(&shared.waiting);
        // dentro del cerrojo: al parar se vacía esta lista y nadie debe quedarse apuntado después
        if shared.stop.load(Ordering::SeqCst) {
            return json(stream, 503, None, "");
        }
        waiting.insert(id, to);
    }
    locked(&shared.bodies).insert(id, text);
    let reply = if (shared.sink)(id) { from.recv_timeout(shared.limits.answer_time).ok() } else { None };
    locked(&shared.waiting).remove(&id);
    locked(&shared.bodies).remove(&id);
    match reply {
        Some(Reply { ok: true, .. }) => {
            let cookie = if content.once { format!("Set-Cookie: {}=1; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict\r\n", cookie_name(&content.key)) } else { String::new() };
            json(stream, 200, None, &cookie);
        }
        Some(Reply { message, .. }) => json(stream, 422, Some(&message), ""),
        None => json(stream, 503, None, ""),
    }
}

// ---------------------------------------------------------------- órdenes de la aplicación

/// Un servidor por ventana: ninguna ventana puede ver las respuestas de otra.
#[derive(Default)]
pub struct Servers(Mutex<HashMap<String, Server>>);

impl Servers {
    pub fn close(&self, window: &str) {
        let server = locked(&self.0).remove(window);
        // fuera del cerrojo: parar espera a que deje de escuchar
        drop(server);
    }
    fn with<T>(&self, window: &str, f: impl FnOnce(&Server) -> T) -> Result<T, String> {
        locked(&self.0).get(window).map(f).ok_or_else(|| "No se están recogiendo respuestas.".to_string())
    }
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Address {
    pub ip: String,
    /// Nombre del adaptador de red; vacío para «solo este equipo».
    pub name: String,
    /// La que usa este equipo para salir a la red: casi siempre es la que sirve.
    pub main: bool,
}

/// La dirección por la que este equipo sale a la red (no se envía nada).
fn main_address() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect((Ipv4Addr::new(192, 0, 2, 1), 9)).ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(a) => Some(a),
        IpAddr::V6(_) => None,
    }
}

/// Las direcciones privadas primero (la principal delante) y, al final, solo este equipo.
fn arrange(found: Vec<(String, Ipv4Addr)>, main: Option<Ipv4Addr>) -> Vec<Address> {
    let mut list: Vec<Address> = found.into_iter().filter(|(_, ip)| ip.is_private()).map(|(name, ip)| Address { ip: ip.to_string(), name, main: Some(ip) == main }).collect();
    list.sort_by(|a, b| b.main.cmp(&a.main).then_with(|| a.name.cmp(&b.name)).then_with(|| a.ip.cmp(&b.ip)));
    list.dedup_by(|a, b| a.ip == b.ip);
    list.push(Address { ip: Ipv4Addr::LOCALHOST.to_string(), name: String::new(), main: false });
    list
}

#[tauri::command]
pub fn forms_server_addresses() -> Vec<Address> {
    let found = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|i| match i.ip() {
            IpAddr::V4(a) => Some((i.name, a)),
            IpAddr::V6(_) => None,
        })
        .collect();
    arrange(found, main_address())
}

#[derive(Serialize)]
pub struct Started {
    pub url: String,
}

#[tauri::command]
pub async fn forms_server_start(window: tauri::WebviewWindow, address: String, content: Content) -> Result<Started, String> {
    let ip: Ipv4Addr = address.parse().map_err(|_| "La dirección no es válida.".to_string())?;
    let label = window.label().to_string();
    let servers = window.state::<Servers>();
    servers.close(&label);
    let app = window.app_handle().clone();
    let to = label.clone();
    let server = Server::start(ip, None, content, Limits::default(), Box::new(move |id| app.emit_to(to.as_str(), "nova-forms-response", id).is_ok()))?;
    let url = server.url();
    locked(&servers.0).insert(label, server);
    Ok(Started { url })
}

#[tauri::command]
pub fn forms_server_update(window: tauri::WebviewWindow, servers: tauri::State<'_, Servers>, content: Content) -> Result<(), String> {
    servers.with(window.label(), |s| s.update(content))?
}

#[tauri::command]
pub fn forms_server_take(window: tauri::WebviewWindow, servers: tauri::State<'_, Servers>, id: u64) -> Result<String, String> {
    servers.with(window.label(), |s| s.take(id))?.ok_or_else(|| "Esa respuesta ya no está.".to_string())
}

#[tauri::command]
pub fn forms_server_reply(window: tauri::WebviewWindow, servers: tauri::State<'_, Servers>, id: u64, ok: bool, message: String) -> Result<(), String> {
    servers.with(window.label(), |s| s.reply(id, ok, message))
}

#[tauri::command]
pub async fn forms_server_stop(window: tauri::WebviewWindow) -> Result<(), String> {
    window.state::<Servers>().close(window.label());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::{channel, Receiver};

    fn content() -> Content {
        Content { page: "<p>formulario ñ</p>".into(), answered: "<p>ya</p>".into(), key: "f-1".into(), once: false, max_body: 2 * MB }
    }

    fn quick() -> Limits {
        Limits { head_time: Duration::from_millis(800), body_time: Duration::from_millis(1500), answer_time: Duration::from_millis(900), ..Limits::default() }
    }

    fn start(content: Content, limits: Limits) -> (Arc<Server>, Receiver<u64>) {
        let (tx, rx) = channel();
        let tx = Mutex::new(tx);
        let server = Server::start(Ipv4Addr::LOCALHOST, Some(0), content, limits, Box::new(move |id| locked(&tx).send(id).is_ok())).unwrap();
        (Arc::new(server), rx)
    }

    /// Contesta cada respuesta que llega, como haría la aplicación.
    fn answering(server: &Arc<Server>, rx: Receiver<u64>, ok: bool, message: &'static str) -> Receiver<String> {
        let (tx, bodies) = channel();
        let s = Arc::downgrade(server);
        std::thread::spawn(move || {
            for id in rx {
                let Some(s) = s.upgrade() else { break };
                let body = s.take(id).unwrap_or_default();
                assert!(s.take(id).is_none(), "solo se entrega una vez");
                let _ = tx.send(body);
                s.reply(id, ok, message.to_string());
            }
        });
        bodies
    }

    fn raw(server: &Server, request: &[u8]) -> String {
        let mut stream = TcpStream::connect(server.address).unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let _ = stream.write_all(request);
        let mut out = Vec::new();
        let _ = stream.read_to_end(&mut out);
        String::from_utf8_lossy(&out).into_owned()
    }

    fn path(server: &Server) -> String {
        format!("/{}", server.shared.token)
    }

    fn get(server: &Server, path: &str, extra: &str) -> String {
        raw(server, format!("GET {path} HTTP/1.1\r\nHost: {}\r\n{extra}\r\n", server.address).as_bytes())
    }

    fn post(server: &Server, body: &str, extra: &str) -> String {
        raw(server, format!("POST {}/r HTTP/1.1\r\nHost: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{extra}\r\n{body}", path(server), server.address, body.len()).as_bytes())
    }

    fn status(response: &str) -> u16 {
        response.split(' ').nth(1).and_then(|s| s.parse().ok()).unwrap_or(0)
    }

    #[test]
    fn sirve_la_pagina_solo_con_la_clave() {
        let (server, _rx) = start(content(), quick());
        assert_eq!(server.url(), format!("http://{}{}", server.address, path(&server)));
        assert_eq!(server.shared.token.len(), 20);
        let page = get(&server, &path(&server), "");
        assert_eq!(status(&page), 200);
        assert!(page.ends_with("<p>formulario ñ</p>"));
        for header in ["Cache-Control: no-store", "X-Content-Type-Options: nosniff", "X-Frame-Options: DENY", "Connection: close", "Content-Type: text/html; charset=utf-8"] {
            assert!(page.contains(header), "{header}");
        }
        assert_eq!(status(&get(&server, &format!("{}/?x=1", path(&server)), "")), 200);
        for other in ["/", "/favicon.ico", "/otra", &format!("{}x", path(&server)), &format!("{}/../x", path(&server)), &path(&server)[..8]] {
            let r = get(&server, other, "");
            assert_eq!(status(&r), 404, "{other}");
            assert!(!r.contains("formulario"));
        }
        let head = raw(&server, format!("HEAD {} HTTP/1.1\r\nHost: {}\r\n\r\n", path(&server), server.address).as_bytes());
        assert!(status(&head) == 200 && head.ends_with("\r\n\r\n"));
        assert_eq!(status(&raw(&server, format!("PUT {} HTTP/1.1\r\nHost: {}\r\n\r\n", path(&server), server.address).as_bytes())), 405);
        assert_eq!(status(&get(&server, &format!("{}/r", path(&server)), "")), 405);
    }

    #[test]
    fn solo_atiende_a_su_propia_direccion() {
        let (server, _rx) = start(content(), quick());
        for host in ["otro.example", "localhost", "127.0.0.1", "127.0.0.1:1"] {
            assert_eq!(status(&raw(&server, format!("GET {} HTTP/1.1\r\nHost: {host}\r\n\r\n", path(&server)).as_bytes())), 403, "{host}");
        }
        assert_eq!(status(&raw(&server, format!("GET {} HTTP/1.1\r\n\r\n", path(&server)).as_bytes())), 403);
        assert_eq!(status(&get(&server, &path(&server), &format!("Host: {}\r\n", server.address))), 403, "repetida");
        assert_eq!(status(&post(&server, "{}", "Origin: http://malo.example\r\n")), 403);
    }

    #[test]
    fn pasa_la_respuesta_y_contesta_lo_que_diga_la_aplicacion() {
        let (server, rx) = start(content(), quick());
        let bodies = answering(&server, rx, true, "");
        let body = "{\"a\":\"ñandú\"}";
        let r = post(&server, body, &format!("Origin: http://{}\r\n", server.address));
        assert_eq!(status(&r), 200, "{r}");
        assert!(r.ends_with("{\"ok\":true}"));
        assert!(!r.contains("Set-Cookie"));
        assert_eq!(bodies.recv_timeout(Duration::from_secs(2)).unwrap(), body);

        let (server, rx) = start(content(), quick());
        let _bodies = answering(&server, rx, false, "Está \"cerrado\"");
        let r = post(&server, "{}", "");
        assert_eq!(status(&r), 422);
        assert!(r.ends_with("{\"message\":\"Está \\\"cerrado\\\"\",\"ok\":false}"), "{r}");
    }

    #[test]
    fn sin_contestacion_dice_que_no_esta_disponible() {
        let (server, rx) = start(content(), quick());
        assert_eq!(status(&post(&server, "{}", "")), 503);
        let id = rx.recv().unwrap();
        assert!(server.take(id).is_none(), "no se guarda lo que nadie recogió");
        let gone = Server::start(Ipv4Addr::LOCALHOST, Some(0), content(), quick(), Box::new(|_| false)).unwrap();
        assert_eq!(status(&post(&gone, "{}", "")), 503);
    }

    #[test]
    fn una_sola_respuesta_por_navegador_si_se_pide() {
        let (server, rx) = start(Content { once: true, ..content() }, quick());
        let _bodies = answering(&server, rx, true, "");
        let r = post(&server, "{}", "");
        assert_eq!(status(&r), 200);
        assert!(r.contains("Set-Cookie: nv_done_f1=1; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict"));
        let cookie = "Cookie: a=b; nv_done_f1=1\r\n";
        assert_eq!(status(&post(&server, "{}", cookie)), 409);
        assert!(get(&server, &path(&server), cookie).ends_with("<p>ya</p>"));
        assert!(get(&server, &path(&server), "Cookie: nv_done_otro=1\r\n").ends_with("<p>formulario ñ</p>"));
        // al cambiar el ajuste, vuelve a admitir
        server.update(content()).unwrap();
        assert!(get(&server, &path(&server), cookie).ends_with("<p>formulario ñ</p>"));
        assert_eq!(status(&post(&server, "{}", cookie)), 200);
    }

    #[test]
    fn rechaza_lo_que_no_es_una_respuesta() {
        let (server, rx) = start(content(), quick());
        let at = format!("POST {}/r HTTP/1.1\r\nHost: {}\r\n", path(&server), server.address);
        let send = |rest: &str| status(&raw(&server, format!("{at}{rest}").as_bytes()));
        assert_eq!(send("Content-Type: text/plain\r\nContent-Length: 2\r\n\r\n{}"), 415);
        assert_eq!(send("Content-Length: 2\r\n\r\n{}"), 415);
        assert_eq!(send("Content-Type: application/json\r\n\r\n{}"), 411);
        assert_eq!(send("Content-Type: application/json\r\nContent-Length: x\r\n\r\n{}"), 400);
        assert_eq!(send("Content-Type: application/json\r\nContent-Length: +2\r\n\r\n{}"), 400);
        assert_eq!(send("Content-Type: application/json\r\nContent-Length: 2\r\nContent-Length: 3\r\n\r\n{}"), 400);
        assert_eq!(send("Content-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n"), 400);
        assert_eq!(status(&raw(&server, &[format!("{at}Content-Type: application/json\r\nContent-Length: 2\r\n\r\n").into_bytes(), vec![0xff, 0xfe]].concat())), 400);
        assert_eq!(send(&format!("Content-Type: application/json\r\nContent-Length: {}\r\n\r\n", 2 * MB + 1)), 413);
        assert_eq!(send("Content-Type: application/json\r\nContent-Length: 99999999999999999999999\r\n\r\n"), 413);
        // el que anuncia más de lo que envía no recibe nada y no llega a la aplicación
        assert_eq!(send("Content-Type: application/json\r\nContent-Length: 50\r\n\r\n{}"), 0);
        assert!(rx.try_recv().is_err());
        assert_eq!(status(&raw(&server, b"basura\r\n\r\n")), 400);
        assert_eq!(status(&get(&server, &path(&server), &format!("X-Larga: {}\r\n", "x".repeat(9000)))), 431);
        assert_eq!(status(&get(&server, &path(&server), &"X: 1\r\n".repeat(60))), 431);
    }

    #[test]
    fn una_respuesta_grande_llega_entera_y_la_demasiado_grande_avisa() {
        let (server, rx) = start(content(), Limits { body_time: Duration::from_secs(10), answer_time: Duration::from_secs(5), ..quick() });
        let bodies = answering(&server, rx, true, "");
        let body = format!("\"{}\"", "a".repeat(MB + MB / 2));
        assert_eq!(status(&post(&server, &body, "")), 200);
        assert_eq!(bodies.recv_timeout(Duration::from_secs(5)).unwrap(), body);
        // se contesta antes de haber leído todo, y la contestación llega
        assert_eq!(status(&post(&server, &"a".repeat(3 * MB), "")), 413);
        assert_eq!(server.shared.large.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn limita_envios_conexiones_y_esperas() {
        let (server, rx) = start(content(), Limits { posts_per_minute: 2, per_address: 2, ..quick() });
        let _bodies = answering(&server, rx, true, "");
        assert_eq!(status(&post(&server, "{}", "")), 200);
        assert_eq!(status(&post(&server, "{}", "")), 200);
        assert_eq!(status(&post(&server, "{}", "")), 429);
        // dos que no dicen nada ocupan los dos sitios; al cabo del tiempo se sueltan
        std::thread::sleep(Duration::from_millis(100));
        let silent: Vec<TcpStream> = (0..2).map(|_| TcpStream::connect(server.address).unwrap()).collect();
        std::thread::sleep(Duration::from_millis(150));
        assert_eq!(status(&get(&server, &path(&server), "")), 0);
        std::thread::sleep(Duration::from_millis(1500));
        assert_eq!(status(&get(&server, &path(&server), "")), 200);
        drop(silent);
    }

    #[test]
    fn al_parar_deja_de_escuchar_y_quien_esperaba_se_entera() {
        let (tx, rx) = channel();
        let tx = Mutex::new(tx);
        let server = Server::start(Ipv4Addr::LOCALHOST, Some(0), content(), Limits { answer_time: Duration::from_secs(30), ..quick() }, Box::new(move |id| locked(&tx).send(id).is_ok())).unwrap();
        let address = server.address;
        let request = format!("POST /{}/r HTTP/1.1\r\nHost: {address}\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{{}}", server.shared.token);
        let waiting = std::thread::spawn(move || {
            let mut stream = TcpStream::connect(address).unwrap();
            stream.write_all(request.as_bytes()).unwrap();
            let mut out = String::new();
            let _ = stream.read_to_string(&mut out);
            out
        });
        rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let began = Instant::now();
        drop(server);
        assert_eq!(status(&waiting.join().unwrap()), 503);
        assert!(began.elapsed() < Duration::from_secs(5));
        assert!(TcpStream::connect_timeout(&address, Duration::from_millis(500)).is_err(), "el puerto queda cerrado");
    }

    #[test]
    fn solo_direcciones_de_la_red_local() {
        for ip in ["0.0.0.0", "8.8.8.8", "100.64.0.1", "192.0.2.1", "255.255.255.255"] {
            assert!(Server::start(ip.parse().unwrap(), Some(0), content(), quick(), Box::new(|_| true)).is_err(), "{ip}");
        }
        for ip in ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.5", "169.254.1.1", "::1"] {
            assert!(is_local(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["8.8.8.8", "172.32.0.1", "2001:db8::1", "::ffff:8.8.8.8"] {
            assert!(!is_local(ip.parse().unwrap()), "{ip}");
        }
        assert!(Server::start(Ipv4Addr::LOCALHOST, Some(0), Content { max_body: MOST_BODY + 1, ..content() }, quick(), Box::new(|_| true)).is_err());
    }

    #[test]
    fn ordena_las_direcciones() {
        let a = |s: &str| s.parse::<Ipv4Addr>().unwrap();
        let list = arrange(vec![("vEthernet".into(), a("172.20.0.1")), ("Wi-Fi".into(), a("192.168.1.20")), ("Pública".into(), a("8.8.4.4")), ("lo".into(), a("127.0.0.1")), ("auto".into(), a("169.254.3.3"))], Some(a("192.168.1.20")));
        assert_eq!(list.iter().map(|x| (x.ip.as_str(), x.main)).collect::<Vec<_>>(), vec![("192.168.1.20", true), ("172.20.0.1", false), ("127.0.0.1", false)]);
        assert!(forms_server_addresses().iter().any(|x| x.ip == "127.0.0.1"));
    }
}
