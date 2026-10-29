//! Servidores IMAP, SMTP y POP3 falsos (en este mismo equipo, sin cifrar) para probar los clientes sin ninguna cuenta real.

use base64::Engine;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;

fn b64(s: &str) -> Vec<u8> {
    base64::engine::general_purpose::STANDARD.decode(s.trim()).unwrap_or_default()
}

fn enc(b: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(b)
}

/// Comprueba la cadena de XOAUTH2: `user=…\x01auth=Bearer …\x01\x01`.
fn xoauth_ok(blob: &[u8], user: &str, token: &str) -> bool {
    String::from_utf8_lossy(blob) == format!("user={user}\x01auth=Bearer {token}\x01\x01")
}

// ------------------------------------------------------------------ IMAP

#[derive(Clone)]
pub struct Msg {
    pub uid: u32,
    pub flags: Vec<String>,
    pub raw: Vec<u8>,
}

#[derive(Clone)]
pub struct Folder {
    pub name: String,
    pub attrs: Vec<String>,
    pub validity: u32,
    pub msgs: Vec<Msg>,
}

pub struct ImapState {
    pub user: String,
    pub pass: String,
    /// Si no es `None`, solo se acepta XOAUTH2 con este token.
    pub token: Option<String>,
    /// ¿Anuncia y entiende `MOVE`? Sin él el cliente debe copiar, marcar y expulsar.
    pub has_move: bool,
    pub folders: Vec<Folder>,
    pub log: Vec<String>,
}

pub struct FakeImap {
    pub port: u16,
    pub state: Arc<Mutex<ImapState>>,
}

impl FakeImap {
    pub fn start(user: &str, pass: &str, folders: Vec<Folder>) -> FakeImap {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let state = Arc::new(Mutex::new(ImapState { user: user.into(), pass: pass.into(), token: None, has_move: true, folders, log: vec![] }));
        let st = state.clone();
        thread::spawn(move || {
            for conn in listener.incoming().flatten() {
                let st = st.clone();
                thread::spawn(move || {
                    let _ = imap_session(conn, st);
                });
            }
        });
        FakeImap { port, state }
    }
    pub fn log(&self) -> Vec<String> {
        self.state.lock().unwrap().log.clone()
    }
    pub fn folder(&self, name: &str) -> Folder {
        self.state.lock().unwrap().folders.iter().find(|f| f.name == name).cloned().unwrap_or_else(|| panic!("no hay carpeta {name}"))
    }
    pub fn has_folder(&self, name: &str) -> bool {
        self.state.lock().unwrap().folders.iter().any(|f| f.name == name)
    }
}

pub fn folder(name: &str, attrs: &[&str], validity: u32, msgs: Vec<Msg>) -> Folder {
    Folder { name: name.into(), attrs: attrs.iter().map(|s| s.to_string()).collect(), validity, msgs }
}

pub fn mail(uid: u32, flags: &[&str], subject: &str, body: &str) -> Msg {
    let raw = format!("From: Ana <ana@ejemplo.es>\r\nTo: luis@ejemplo.es\r\nSubject: {subject}\r\nMessage-ID: <{uid}@fake>\r\nDate: Mon, 3 Mar 2025 10:00:00 +0000\r\n\r\n{body}\r\n");
    Msg { uid, flags: flags.iter().map(|s| s.to_string()).collect(), raw: raw.into_bytes() }
}

fn parse_set(set: &str, max: u32) -> Vec<(u32, u32)> {
    set.split(',')
        .filter_map(|p| {
            let (a, b) = p.split_once(':').unwrap_or((p, p));
            let lo = if a == "*" { max } else { a.parse().ok()? };
            let hi = if b == "*" { max } else { b.parse().ok()? };
            Some((lo.min(hi), lo.max(hi)))
        })
        .collect()
}

fn in_set(set: &[(u32, u32)], uid: u32) -> bool {
    set.iter().any(|(a, b)| uid >= *a && uid <= *b)
}

fn unquote(s: &str) -> String {
    s.trim().trim_matches('"').to_string()
}

fn imap_session(conn: TcpStream, st: Arc<Mutex<ImapState>>) -> std::io::Result<()> {
    let mut w = conn.try_clone()?;
    let mut r = BufReader::new(conn);
    w.write_all(b"* OK IMAP4rev1 fake ready\r\n")?;
    let mut authed = false;
    let mut sel: Option<usize> = None;
    let mut line = String::new();
    loop {
        line.clear();
        if r.read_line(&mut line)? == 0 {
            return Ok(());
        }
        let l = line.trim_end().to_string();
        let (tag, rest) = l.split_once(' ').unwrap_or((&l, ""));
        let cmd = rest.split(' ').next().unwrap_or("").to_uppercase();
        {
            // las contraseñas y los tokens no se guardan en el registro
            let shown = if cmd == "LOGIN" { format!("{tag} LOGIN ***") } else if cmd == "AUTHENTICATE" { format!("{tag} AUTHENTICATE ***") } else { l.clone() };
            st.lock().unwrap().log.push(shown);
        }
        let args = rest.get(cmd.len()..).unwrap_or("").trim().to_string();
        match cmd.as_str() {
            "CAPABILITY" => {
                let mv = st.lock().unwrap().has_move;
                w.write_all(format!("* CAPABILITY IMAP4rev1 UIDPLUS AUTH=XOAUTH2{}\r\n{tag} OK done\r\n", if mv { " MOVE" } else { "" }).as_bytes())?
            }
            "NOOP" => w.write_all(format!("{tag} OK done\r\n").as_bytes())?,
            "LOGIN" => {
                let parts: Vec<String> = args.split(' ').map(|s| s.trim_matches('"').to_string()).collect();
                let ok = {
                    let s = st.lock().unwrap();
                    s.token.is_none() && parts.len() == 2 && parts[0] == s.user && parts[1] == s.pass
                };
                if ok {
                    authed = true;
                    w.write_all(format!("{tag} OK LOGIN completed\r\n").as_bytes())?;
                } else {
                    w.write_all(format!("{tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n").as_bytes())?;
                }
            }
            "AUTHENTICATE" => {
                let mut it = args.split(' ');
                let mech = it.next().unwrap_or("").to_uppercase();
                let initial = it.next().map(|s| s.to_string());
                if mech != "XOAUTH2" {
                    w.write_all(format!("{tag} NO unsupported mechanism\r\n").as_bytes())?;
                    continue;
                }
                let blob = match initial {
                    Some(i) => i,
                    None => {
                        w.write_all(b"+ \r\n")?;
                        let mut b = String::new();
                        r.read_line(&mut b)?;
                        b
                    }
                };
                let ok = {
                    let s = st.lock().unwrap();
                    s.token.as_deref().map_or(false, |t| xoauth_ok(&b64(&blob), &s.user, t))
                };
                if ok {
                    authed = true;
                    w.write_all(format!("{tag} OK AUTHENTICATE completed\r\n").as_bytes())?;
                } else {
                    // el servidor avisa del error en JSON y el cliente contesta con una línea vacía
                    w.write_all(format!("+ {}\r\n", enc(br#"{"status":"401","schemes":"Bearer","scope":"https://mail.google.com/"}"#)).as_bytes())?;
                    let mut empty = String::new();
                    r.read_line(&mut empty)?;
                    w.write_all(format!("{tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n").as_bytes())?;
                }
            }
            "LOGOUT" => {
                w.write_all(format!("* BYE bye\r\n{tag} OK done\r\n").as_bytes())?;
                return Ok(());
            }
            _ if !authed => w.write_all(format!("{tag} NO not authenticated\r\n").as_bytes())?,
            "LIST" => {
                let s = st.lock().unwrap();
                for f in &s.folders {
                    w.write_all(format!("* LIST ({}) \"/\" \"{}\"\r\n", f.attrs.join(" "), f.name).as_bytes())?;
                }
                w.write_all(format!("{tag} OK done\r\n").as_bytes())?;
            }
            "CREATE" => {
                let name = unquote(&args);
                let mut s = st.lock().unwrap();
                if s.folders.iter().any(|f| f.name == name) {
                    w.write_all(format!("{tag} NO [ALREADYEXISTS] exists\r\n").as_bytes())?;
                } else {
                    s.folders.push(Folder { name, attrs: vec![], validity: 100, msgs: vec![] });
                    w.write_all(format!("{tag} OK done\r\n").as_bytes())?;
                }
            }
            "DELETE" => {
                let name = unquote(&args);
                let mut s = st.lock().unwrap();
                let before = s.folders.len();
                s.folders.retain(|f| f.name != name);
                if s.folders.len() == before {
                    w.write_all(format!("{tag} NO no such mailbox\r\n").as_bytes())?;
                } else {
                    w.write_all(format!("{tag} OK done\r\n").as_bytes())?;
                }
            }
            "SELECT" | "EXAMINE" => {
                let name = unquote(&args);
                let s = st.lock().unwrap();
                match s.folders.iter().position(|f| f.name == name) {
                    Some(i) => {
                        sel = Some(i);
                        let f = &s.folders[i];
                        let next = f.msgs.iter().map(|m| m.uid).max().unwrap_or(0) + 1;
                        w.write_all(format!("* FLAGS (\\Seen \\Flagged \\Answered \\Deleted)\r\n* {} EXISTS\r\n* 0 RECENT\r\n* OK [UIDVALIDITY {}] ok\r\n* OK [UIDNEXT {}] ok\r\n{tag} OK [READ-WRITE] done\r\n", f.msgs.len(), f.validity, next).as_bytes())?;
                    }
                    None => w.write_all(format!("{tag} NO no such mailbox\r\n").as_bytes())?,
                }
            }
            "EXPUNGE" => {
                let Some(i) = sel else {
                    w.write_all(format!("{tag} BAD no mailbox selected\r\n").as_bytes())?;
                    continue;
                };
                st.lock().unwrap().folders[i].msgs.retain(|m| !m.flags.iter().any(|f| f == "\\Deleted"));
                w.write_all(format!("{tag} OK done\r\n").as_bytes())?;
            }
            "UID" => {
                let (sub, tail) = args.split_once(' ').unwrap_or((&args, ""));
                let Some(i) = sel else {
                    w.write_all(format!("{tag} BAD no mailbox selected\r\n").as_bytes())?;
                    continue;
                };
                match sub.to_uppercase().as_str() {
                    "SEARCH" => {
                        let s = st.lock().unwrap();
                        let f = &s.folders[i];
                        let max = f.msgs.iter().map(|m| m.uid).max().unwrap_or(0);
                        // UID a:* siempre incluye el último mensaje, aunque a sea mayor
                        let set = parse_set(tail.trim().trim_start_matches("UID ").trim(), max);
                        let uids: Vec<String> = f.msgs.iter().filter(|m| in_set(&set, m.uid)).map(|m| m.uid.to_string()).collect();
                        w.write_all(format!("* SEARCH {}\r\n{tag} OK done\r\n", uids.join(" ")).as_bytes())?;
                    }
                    "FETCH" => {
                        let (set_s, items) = tail.split_once(' ').unwrap_or((tail, ""));
                        let s = st.lock().unwrap();
                        let f = &s.folders[i];
                        let max = f.msgs.iter().map(|m| m.uid).max().unwrap_or(0);
                        let set = parse_set(set_s, max);
                        for (seq, m) in f.msgs.iter().enumerate().filter(|(_, m)| in_set(&set, m.uid)) {
                            let mut out = format!("* {} FETCH (UID {}", seq + 1, m.uid).into_bytes();
                            if items.contains("FLAGS") {
                                out.extend(format!(" FLAGS ({})", m.flags.join(" ")).into_bytes());
                            }
                            if items.contains("RFC822.SIZE") {
                                out.extend(format!(" RFC822.SIZE {}", m.raw.len()).into_bytes());
                            }
                            if items.contains("BODY.PEEK[]") || items.contains("BODY[]") {
                                out.extend(format!(" BODY[] {{{}}}\r\n", m.raw.len()).into_bytes());
                                out.extend(&m.raw);
                            }
                            out.extend(b")\r\n");
                            w.write_all(&out)?;
                        }
                        w.write_all(format!("{tag} OK done\r\n").as_bytes())?;
                    }
                    "STORE" => {
                        let (set_s, what) = tail.split_once(' ').unwrap_or((tail, ""));
                        let mut s = st.lock().unwrap();
                        let f = &mut s.folders[i];
                        let max = f.msgs.iter().map(|m| m.uid).max().unwrap_or(0);
                        let set = parse_set(set_s, max);
                        let add = what.starts_with('+');
                        let flags: Vec<String> = what.split('(').nth(1).unwrap_or("").trim_end_matches(')').split(' ').filter(|x| !x.is_empty()).map(|x| x.to_string()).collect();
                        for m in f.msgs.iter_mut().filter(|m| in_set(&set, m.uid)) {
                            for fl in &flags {
                                m.flags.retain(|x| x != fl);
                                if add {
                                    m.flags.push(fl.clone());
                                }
                            }
                        }
                        w.write_all(format!("{tag} OK done\r\n").as_bytes())?;
                    }
                    "COPY" | "MOVE" => {
                        let (set_s, dest) = tail.split_once(' ').unwrap_or((tail, ""));
                        let dest = unquote(dest);
                        let mut s = st.lock().unwrap();
                        if sub.eq_ignore_ascii_case("MOVE") && !s.has_move {
                            w.write_all(format!("{tag} BAD unknown command\r\n").as_bytes())?;
                            continue;
                        }
                        let Some(di) = s.folders.iter().position(|f| f.name == dest) else {
                            w.write_all(format!("{tag} NO [TRYCREATE] no such mailbox\r\n").as_bytes())?;
                            continue;
                        };
                        let max = s.folders[i].msgs.iter().map(|m| m.uid).max().unwrap_or(0);
                        let set = parse_set(set_s, max);
                        let moved: Vec<Msg> = s.folders[i].msgs.iter().filter(|m| in_set(&set, m.uid)).cloned().collect();
                        for m in moved {
                            let uid = s.folders[di].msgs.iter().map(|x| x.uid).max().unwrap_or(0) + 1;
                            s.folders[di].msgs.push(Msg { uid, flags: m.flags.iter().filter(|f| *f != "\\Deleted").cloned().collect(), raw: m.raw });
                        }
                        if sub.eq_ignore_ascii_case("MOVE") {
                            s.folders[i].msgs.retain(|m| !in_set(&set, m.uid));
                        }
                        w.write_all(format!("{tag} OK done\r\n").as_bytes())?;
                    }
                    "EXPUNGE" => {
                        let mut s = st.lock().unwrap();
                        let max = s.folders[i].msgs.iter().map(|m| m.uid).max().unwrap_or(0);
                        let set = parse_set(tail.trim(), max);
                        s.folders[i].msgs.retain(|m| !(in_set(&set, m.uid) && m.flags.iter().any(|f| f == "\\Deleted")));
                        w.write_all(format!("{tag} OK done\r\n").as_bytes())?;
                    }
                    _ => w.write_all(format!("{tag} BAD unknown\r\n").as_bytes())?,
                }
            }
            "APPEND" => {
                // APPEND "carpeta" (\Seen) {n}
                let name = args.split('"').nth(1).unwrap_or("").to_string();
                let flags: Vec<String> = args.split('(').nth(1).and_then(|s| s.split(')').next()).unwrap_or("").split(' ').filter(|x| !x.is_empty()).map(|x| x.to_string()).collect();
                let n: usize = args.rsplit('{').next().unwrap_or("0").trim_end_matches('}').trim_end_matches('+').parse().unwrap_or(0);
                w.write_all(b"+ go ahead\r\n")?;
                let mut buf = vec![0u8; n];
                r.read_exact(&mut buf)?;
                let mut crlf = String::new();
                r.read_line(&mut crlf)?;
                let mut s = st.lock().unwrap();
                match s.folders.iter_mut().find(|f| f.name == name) {
                    Some(f) => {
                        let uid = f.msgs.iter().map(|m| m.uid).max().unwrap_or(0) + 1;
                        f.msgs.push(Msg { uid, flags, raw: buf });
                        w.write_all(format!("{tag} OK [APPENDUID {} {}] done\r\n", f.validity, uid).as_bytes())?;
                    }
                    None => w.write_all(format!("{tag} NO [TRYCREATE] no such mailbox\r\n").as_bytes())?,
                }
            }
            _ => w.write_all(format!("{tag} BAD unknown command\r\n").as_bytes())?,
        }
    }
}

// ------------------------------------------------------------------ SMTP

#[derive(Clone, Debug)]
pub struct Sent {
    pub from: String,
    pub rcpts: Vec<String>,
    pub data: Vec<u8>,
}

pub struct SmtpState {
    pub user: String,
    pub pass: String,
    pub token: Option<String>,
    /// Los destinatarios de este dominio se rechazan.
    pub reject_domain: Option<String>,
    pub sent: Vec<Sent>,
    pub log: Vec<String>,
}

pub struct FakeSmtp {
    pub port: u16,
    pub state: Arc<Mutex<SmtpState>>,
}

impl FakeSmtp {
    pub fn start(user: &str, pass: &str) -> FakeSmtp {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let state = Arc::new(Mutex::new(SmtpState { user: user.into(), pass: pass.into(), token: None, reject_domain: None, sent: vec![], log: vec![] }));
        let st = state.clone();
        thread::spawn(move || {
            for conn in listener.incoming().flatten() {
                let st = st.clone();
                thread::spawn(move || {
                    let _ = smtp_session(conn, st);
                });
            }
        });
        FakeSmtp { port, state }
    }
    pub fn sent(&self) -> Vec<Sent> {
        self.state.lock().unwrap().sent.clone()
    }
}

fn smtp_session(conn: TcpStream, st: Arc<Mutex<SmtpState>>) -> std::io::Result<()> {
    let mut w = conn.try_clone()?;
    let mut r = BufReader::new(conn);
    w.write_all(b"220 fake ESMTP ready\r\n")?;
    let (mut from, mut rcpts, mut authed) = (String::new(), Vec::<String>::new(), false);
    let mut line = String::new();
    let read = |r: &mut BufReader<TcpStream>, line: &mut String| -> std::io::Result<Option<String>> {
        line.clear();
        Ok(if r.read_line(line)? == 0 { None } else { Some(line.trim_end().to_string()) })
    };
    while let Some(l) = read(&mut r, &mut line)? {
        let up = l.to_uppercase();
        st.lock().unwrap().log.push(if up.starts_with("AUTH") { "AUTH ***".into() } else { l.clone() });
        let (user, pass, token) = {
            let s = st.lock().unwrap();
            (s.user.clone(), s.pass.clone(), s.token.clone())
        };
        if up.starts_with("EHLO") || up.starts_with("HELO") {
            w.write_all(b"250-fake\r\n250-AUTH PLAIN LOGIN XOAUTH2\r\n250 8BITMIME\r\n")?;
        } else if up.starts_with("AUTH XOAUTH2") {
            let arg = l[12..].trim().to_string();
            let data = if arg.is_empty() {
                w.write_all(b"334 \r\n")?;
                read(&mut r, &mut line)?.unwrap_or_default()
            } else {
                arg
            };
            authed = token.as_deref().map_or(false, |t| xoauth_ok(&b64(&data), &user, t));
            if authed {
                w.write_all(b"235 2.7.0 ok\r\n")?;
            } else {
                w.write_all(format!("334 {}\r\n", enc(br#"{"status":"401"}"#)).as_bytes())?;
                read(&mut r, &mut line)?;
                w.write_all(b"535 5.7.8 bad credentials\r\n")?;
            }
        } else if up.starts_with("AUTH PLAIN") {
            let arg = l[10..].trim().to_string();
            let data = if arg.is_empty() {
                w.write_all(b"334 \r\n")?;
                read(&mut r, &mut line)?.unwrap_or_default()
            } else {
                arg
            };
            let parts = b64(&data);
            let mut it = parts.split(|b| *b == 0);
            it.next();
            let (u, p) = (String::from_utf8_lossy(it.next().unwrap_or(b"")).to_string(), String::from_utf8_lossy(it.next().unwrap_or(b"")).to_string());
            authed = token.is_none() && u == user && p == pass;
            w.write_all(if authed { b"235 2.7.0 ok\r\n".as_slice() } else { b"535 5.7.8 bad credentials\r\n".as_slice() })?;
        } else if up.starts_with("AUTH LOGIN") {
            w.write_all(b"334 VXNlcm5hbWU6\r\n")?;
            let u = String::from_utf8_lossy(&b64(&read(&mut r, &mut line)?.unwrap_or_default())).to_string();
            w.write_all(b"334 UGFzc3dvcmQ6\r\n")?;
            let p = String::from_utf8_lossy(&b64(&read(&mut r, &mut line)?.unwrap_or_default())).to_string();
            authed = token.is_none() && u == user && p == pass;
            w.write_all(if authed { b"235 2.7.0 ok\r\n".as_slice() } else { b"535 5.7.8 bad credentials\r\n".as_slice() })?;
        } else if up.starts_with("MAIL FROM:") {
            if !authed {
                w.write_all(b"530 5.7.0 authentication required\r\n")?;
                continue;
            }
            from = l[10..].trim().trim_start_matches('<').split('>').next().unwrap_or("").to_string();
            rcpts.clear();
            w.write_all(b"250 ok\r\n")?;
        } else if up.starts_with("RCPT TO:") {
            let to = l[8..].trim().trim_start_matches('<').split('>').next().unwrap_or("").to_string();
            let reject = st.lock().unwrap().reject_domain.clone();
            if reject.map_or(false, |d| to.ends_with(&format!("@{d}"))) {
                w.write_all(b"550 5.1.1 no such user\r\n")?;
            } else {
                rcpts.push(to);
                w.write_all(b"250 ok\r\n")?;
            }
        } else if up == "DATA" {
            if rcpts.is_empty() {
                w.write_all(b"503 need RCPT\r\n")?;
                continue;
            }
            w.write_all(b"354 end with <CRLF>.<CRLF>\r\n")?;
            let mut data = Vec::new();
            loop {
                line.clear();
                if r.read_line(&mut line)? == 0 {
                    return Ok(());
                }
                if line == ".\r\n" {
                    break;
                }
                data.extend(line.strip_prefix('.').filter(|_| line.starts_with("..")).unwrap_or(&line).as_bytes());
            }
            st.lock().unwrap().sent.push(Sent { from: from.clone(), rcpts: rcpts.clone(), data });
            w.write_all(b"250 queued\r\n")?;
        } else if up == "QUIT" {
            w.write_all(b"221 bye\r\n")?;
            return Ok(());
        } else if up == "RSET" || up == "NOOP" {
            w.write_all(b"250 ok\r\n")?;
        } else {
            w.write_all(b"500 unknown\r\n")?;
        }
    }
    Ok(())
}

// ------------------------------------------------------------------ POP3

pub struct Pop3State {
    pub user: String,
    pub pass: String,
    pub token: Option<String>,
    /// (UIDL, mensaje)
    pub msgs: Vec<(String, Vec<u8>)>,
    pub log: Vec<String>,
}

pub struct FakePop3 {
    pub port: u16,
    pub state: Arc<Mutex<Pop3State>>,
}

impl FakePop3 {
    pub fn start(user: &str, pass: &str, msgs: Vec<(String, Vec<u8>)>) -> FakePop3 {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let state = Arc::new(Mutex::new(Pop3State { user: user.into(), pass: pass.into(), token: None, msgs, log: vec![] }));
        let st = state.clone();
        thread::spawn(move || {
            for conn in listener.incoming().flatten() {
                let st = st.clone();
                thread::spawn(move || {
                    let _ = pop3_session(conn, st);
                });
            }
        });
        FakePop3 { port, state }
    }
    pub fn uidls(&self) -> Vec<String> {
        self.state.lock().unwrap().msgs.iter().map(|m| m.0.clone()).collect()
    }
    pub fn log(&self) -> Vec<String> {
        self.state.lock().unwrap().log.clone()
    }
}

fn pop3_session(conn: TcpStream, st: Arc<Mutex<Pop3State>>) -> std::io::Result<()> {
    let mut w = conn.try_clone()?;
    let mut r = BufReader::new(conn);
    w.write_all(b"+OK fake POP3 ready\r\n")?;
    let (mut authed, mut user_ok) = (false, false);
    // los DELE solo valen al terminar con QUIT
    let mut deleted: Vec<usize> = vec![];
    // los números de mensaje de esta sesión, fijados al abrirla
    let session: Vec<(String, Vec<u8>)> = st.lock().unwrap().msgs.clone();
    let mut line = String::new();
    loop {
        line.clear();
        if r.read_line(&mut line)? == 0 {
            return Ok(());
        }
        let l = line.trim_end().to_string();
        let up = l.to_uppercase();
        st.lock().unwrap().log.push(if up.starts_with("PASS") { "PASS ***".into() } else if up.starts_with("AUTH") { "AUTH ***".into() } else { l.clone() });
        let (user, pass, token) = {
            let s = st.lock().unwrap();
            (s.user.clone(), s.pass.clone(), s.token.clone())
        };
        if up.starts_with("USER ") {
            user_ok = token.is_none() && l[5..].trim() == user;
            w.write_all(if user_ok { b"+OK\r\n".as_slice() } else { b"-ERR no such user\r\n".as_slice() })?;
        } else if up.starts_with("PASS ") {
            authed = user_ok && l[5..] == pass;
            w.write_all(if authed { b"+OK logged in\r\n".as_slice() } else { b"-ERR [AUTH] bad password\r\n".as_slice() })?;
        } else if up.starts_with("AUTH XOAUTH2") {
            let blob = l[12..].trim();
            authed = token.as_deref().map_or(false, |t| xoauth_ok(&b64(blob), &user, t));
            if authed {
                w.write_all(b"+OK logged in\r\n")?;
            } else {
                w.write_all(format!("+ {}\r\n", enc(br#"{"status":"400"}"#)).as_bytes())?;
                let mut e = String::new();
                r.read_line(&mut e)?;
                w.write_all(b"-ERR [AUTH] authentication failed\r\n")?;
            }
        } else if up == "QUIT" {
            if authed && !deleted.is_empty() {
                let gone: Vec<String> = deleted.iter().map(|i| session[*i].0.clone()).collect();
                st.lock().unwrap().msgs.retain(|m| !gone.contains(&m.0));
            }
            w.write_all(b"+OK bye\r\n")?;
            return Ok(());
        } else if !authed {
            w.write_all(b"-ERR not authenticated\r\n")?;
        } else if up == "UIDL" {
            let mut out = String::from("+OK\r\n");
            for (i, m) in session.iter().enumerate().filter(|(i, _)| !deleted.contains(i)) {
                out.push_str(&format!("{} {}\r\n", i + 1, m.0));
            }
            out.push_str(".\r\n");
            w.write_all(out.as_bytes())?;
        } else if up == "LIST" {
            let mut out = String::from("+OK\r\n");
            for (i, m) in session.iter().enumerate().filter(|(i, _)| !deleted.contains(i)) {
                out.push_str(&format!("{} {}\r\n", i + 1, m.1.len()));
            }
            out.push_str(".\r\n");
            w.write_all(out.as_bytes())?;
        } else if up.starts_with("RETR ") {
            match l[5..].trim().parse::<usize>().ok().filter(|n| *n >= 1 && *n <= session.len() && !deleted.contains(&(n - 1))) {
                Some(n) => {
                    w.write_all(b"+OK\r\n")?;
                    // los puntos del inicio de línea se duplican y se acaba con una línea de un punto
                    let mut body = Vec::new();
                    for ln in session[n - 1].1.split_inclusive(|b| *b == b'\n') {
                        if ln.starts_with(b".") {
                            body.push(b'.');
                        }
                        body.extend_from_slice(ln);
                    }
                    if !body.ends_with(b"\n") {
                        body.extend_from_slice(b"\r\n");
                    }
                    w.write_all(&body)?;
                    w.write_all(b".\r\n")?;
                }
                None => w.write_all(b"-ERR no such message\r\n")?,
            }
        } else if up.starts_with("DELE ") {
            match l[5..].trim().parse::<usize>().ok().filter(|n| *n >= 1 && *n <= session.len()) {
                Some(n) => {
                    deleted.push(n - 1);
                    w.write_all(b"+OK marked\r\n")?;
                }
                None => w.write_all(b"-ERR no such message\r\n")?,
            }
        } else {
            w.write_all(b"-ERR unknown\r\n")?;
        }
    }
}
