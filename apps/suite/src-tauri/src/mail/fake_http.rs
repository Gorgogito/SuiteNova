//! Servidores HTTP falsos (en este mismo equipo, sin cifrar): JMAP, Exchange (EWS) y el punto de tokens de OAuth.
//! Siguen lo que dicen los estándares tal como yo los entiendo, así que prueban que el cliente es coherente con ellos, no que
//! funcione con Fastmail, Exchange o Google de verdad.

use super::ews_client::{esc, parse_xml, Node};
use base64::Engine;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;

pub struct Req {
    pub method: String,
    pub path: String,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

pub struct Resp {
    pub status: u16,
    pub content_type: &'static str,
    pub body: Vec<u8>,
}

impl Resp {
    pub fn json(v: Value) -> Resp {
        Resp { status: 200, content_type: "application/json", body: v.to_string().into_bytes() }
    }
    pub fn status(status: u16) -> Resp {
        Resp { status, content_type: "text/plain", body: vec![] }
    }
}

type Handler = Arc<dyn Fn(&Req, u16) -> Resp + Send + Sync>;

/// Arranca un servidor HTTP en un puerto libre. El manejador recibe la petición y el puerto.
pub fn serve(handler: Handler) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    thread::spawn(move || {
        for conn in listener.incoming().flatten() {
            let h = handler.clone();
            thread::spawn(move || {
                let _ = session(conn, h, port);
            });
        }
    });
    port
}

fn session(conn: TcpStream, h: Handler, port: u16) -> std::io::Result<()> {
    let mut w = conn.try_clone()?;
    let mut r = BufReader::new(conn);
    let mut first = String::new();
    if r.read_line(&mut first)? == 0 {
        return Ok(());
    }
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("").to_string();
    let mut headers = HashMap::new();
    loop {
        let mut l = String::new();
        r.read_line(&mut l)?;
        let l = l.trim_end();
        if l.is_empty() {
            break;
        }
        if let Some((k, v)) = l.split_once(':') {
            headers.insert(k.trim().to_lowercase(), v.trim().to_string());
        }
    }
    let n: usize = headers.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
    let mut body = vec![0u8; n];
    r.read_exact(&mut body)?;
    let resp = h(&Req { method, path, headers, body }, port);
    w.write_all(format!("HTTP/1.1 {} X\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", resp.status, resp.content_type, resp.body.len()).as_bytes())?;
    w.write_all(&resp.body)?;
    w.flush()
}

fn basic(user: &str, pass: &str) -> String {
    format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(format!("{user}:{pass}")))
}

/// ¿La cabecera Authorization coincide con la contraseña o el token esperados?
fn authorized(req: &Req, user: &str, pass: &str, token: &Option<String>) -> bool {
    let got = req.headers.get("authorization").map(String::as_str).unwrap_or("");
    match token {
        Some(t) => got == format!("Bearer {t}"),
        None => got == basic(user, pass),
    }
}

// ------------------------------------------------------------------ JMAP

#[derive(Clone)]
pub struct JEmail {
    pub id: String,
    pub mailboxes: Vec<String>,
    pub keywords: HashSet<String>,
    pub raw: Vec<u8>,
    pub received: u64,
}

pub struct JState {
    pub user: String,
    pub pass: String,
    pub token: Option<String>,
    /// (id, nombre, padre, rol)
    pub boxes: Vec<(String, String, Option<String>, Option<String>)>,
    pub emails: Vec<JEmail>,
    pub blobs: HashMap<String, Vec<u8>>,
    pub submitted: Vec<(String, Vec<String>, Vec<u8>)>,
    pub reject_domain: Option<String>,
    next: u32,
}

pub struct FakeJmap {
    pub port: u16,
    pub state: Arc<Mutex<JState>>,
}

pub fn jemail(id: &str, mailbox: &str, keywords: &[&str], subject: &str, received: u64) -> JEmail {
    let raw = format!("From: Ana <ana@ejemplo.es>\r\nTo: luis@ejemplo.es\r\nSubject: {subject}\r\nMessage-ID: <{id}@jmap>\r\nDate: Mon, 3 Mar 2025 10:00:00 +0000\r\n\r\ncuerpo de {id}\r\n");
    JEmail { id: id.into(), mailboxes: vec![mailbox.into()], keywords: keywords.iter().map(|s| s.to_string()).collect(), raw: raw.into_bytes(), received }
}

impl FakeJmap {
    pub fn start(user: &str, pass: &str) -> FakeJmap {
        let boxes = vec![
            ("mb-inbox".into(), "Inbox".into(), None, Some("inbox".into())),
            ("mb-drafts".into(), "Drafts".into(), None, Some("drafts".into())),
            ("mb-sent".into(), "Sent".into(), None, Some("sent".into())),
            ("mb-trash".into(), "Trash".into(), None, Some("trash".into())),
            ("mb-work".into(), "Trabajo".into(), None, None),
            ("mb-proj".into(), "Proyecto A".into(), Some("mb-work".into()), None),
        ];
        let state = Arc::new(Mutex::new(JState { user: user.into(), pass: pass.into(), token: None, boxes, emails: vec![], blobs: HashMap::new(), submitted: vec![], reject_domain: None, next: 1 }));
        let st = state.clone();
        let port = serve(Arc::new(move |req, port| jmap_handle(&st, req, port)));
        FakeJmap { port, state }
    }
    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}/session", self.port)
    }
    pub fn email(&self, id: &str) -> Option<JEmail> {
        self.state.lock().unwrap().emails.iter().find(|e| e.id == id).cloned()
    }
}

fn jmap_handle(st: &Arc<Mutex<JState>>, req: &Req, port: u16) -> Resp {
    let mut s = st.lock().unwrap();
    if !authorized(req, &s.user.clone(), &s.pass.clone(), &s.token.clone()) {
        return Resp::status(401);
    }
    let path = req.path.split('?').next().unwrap_or("");
    if path == "/session" {
        return Resp::json(json!({
            "capabilities": { "urn:ietf:params:jmap:core": {}, "urn:ietf:params:jmap:mail": {}, "urn:ietf:params:jmap:submission": {} },
            "accounts": { "A1": { "name": s.user, "isPersonal": true } },
            "primaryAccounts": { "urn:ietf:params:jmap:mail": "A1" },
            "apiUrl": format!("http://127.0.0.1:{port}/api"),
            "downloadUrl": format!("http://127.0.0.1:{port}/dl/{{accountId}}/{{blobId}}/{{name}}?type={{type}}"),
            "uploadUrl": format!("http://127.0.0.1:{port}/up/{{accountId}}"),
        }));
    }
    if path.starts_with("/up/") && req.method == "POST" {
        let id = format!("blob-{}", s.next);
        s.next += 1;
        s.blobs.insert(id.clone(), req.body.clone());
        return Resp::json(json!({ "accountId": "A1", "blobId": id, "type": "message/rfc822", "size": req.body.len() }));
    }
    if path.starts_with("/dl/") {
        let blob = path.split('/').nth(3).unwrap_or("");
        let from_email = blob.strip_prefix("b-").and_then(|id| s.emails.iter().find(|e| e.id == id)).map(|e| e.raw.clone());
        return match from_email.or_else(|| s.blobs.get(blob).cloned()) {
            Some(b) => Resp { status: 200, content_type: "message/rfc822", body: b },
            None => Resp::status(404),
        };
    }
    if path != "/api" {
        return Resp::status(404);
    }
    let body: Value = serde_json::from_slice(&req.body).unwrap_or_default();
    let mut responses = vec![];
    let mut created: HashMap<String, String> = HashMap::new();
    for call in body["methodCalls"].as_array().cloned().unwrap_or_default() {
        let (name, args, cid) = (call[0].as_str().unwrap_or(""), call[1].clone(), call[2].as_str().unwrap_or("").to_string());
        let out = jmap_method(&mut s, name, &args, &mut created);
        responses.push(match out {
            Ok(v) => json!([name, v, cid]),
            Err(e) => json!(["error", { "type": "serverFail", "description": e }, cid]),
        });
    }
    Resp::json(json!({ "methodResponses": responses, "sessionState": "s1" }))
}

fn patch_email(e: &mut JEmail, patch: &Value) {
    if let Some(o) = patch.as_object() {
        for (k, v) in o {
            if let Some(kw) = k.strip_prefix("keywords/") {
                if v.is_null() {
                    e.keywords.remove(kw);
                } else {
                    e.keywords.insert(kw.to_string());
                }
            } else if let Some(mb) = k.strip_prefix("mailboxIds/") {
                e.mailboxes.retain(|m| m != mb);
                if !v.is_null() {
                    e.mailboxes.push(mb.to_string());
                }
            }
        }
    }
}

fn jmap_method(s: &mut JState, name: &str, a: &Value, created: &mut HashMap<String, String>) -> Result<Value, String> {
    match name {
        "Mailbox/get" => Ok(json!({ "accountId": "A1", "list": s.boxes.iter().map(|(id, n, p, r)| json!({ "id": id, "name": n, "parentId": p, "role": r })).collect::<Vec<_>>() })),
        "Mailbox/set" => {
            let mut out = json!({ "accountId": "A1" });
            if let Some(c) = a["create"].as_object() {
                let mut ok = serde_json::Map::new();
                for (k, v) in c {
                    let id = format!("mb-new{}", s.next);
                    s.next += 1;
                    s.boxes.push((id.clone(), v["name"].as_str().unwrap_or("").to_string(), v["parentId"].as_str().map(|x| x.to_string()), None));
                    ok.insert(k.clone(), json!({ "id": id }));
                }
                out["created"] = Value::Object(ok);
            }
            if let Some(d) = a["destroy"].as_array() {
                let mut bad = serde_json::Map::new();
                for id in d.iter().filter_map(|x| x.as_str()) {
                    if s.emails.iter().any(|e| e.mailboxes.iter().any(|m| m == id)) {
                        bad.insert(id.into(), json!({ "type": "mailboxHasEmail" }));
                    } else {
                        s.boxes.retain(|b| b.0 != id);
                    }
                }
                if !bad.is_empty() {
                    out["notDestroyed"] = Value::Object(bad);
                }
            }
            Ok(out)
        }
        "Email/query" => {
            let mb = a["filter"]["inMailbox"].as_str().unwrap_or("");
            let mut v: Vec<&JEmail> = s.emails.iter().filter(|e| e.mailboxes.iter().any(|m| m == mb)).collect();
            v.sort_by_key(|e| std::cmp::Reverse(e.received));
            Ok(json!({ "accountId": "A1", "ids": v.iter().map(|e| e.id.clone()).collect::<Vec<_>>(), "position": 0 }))
        }
        "Email/get" => {
            let ids: Vec<String> = a["ids"].as_array().map(|x| x.iter().filter_map(|i| i.as_str().map(|s| s.to_string())).collect()).unwrap_or_default();
            let list: Vec<Value> = ids
                .iter()
                .filter_map(|id| s.emails.iter().find(|e| &e.id == id))
                .map(|e| {
                    let kw: serde_json::Map<String, Value> = e.keywords.iter().map(|k| (k.clone(), json!(true))).collect();
                    json!({ "id": e.id, "blobId": format!("b-{}", e.id), "size": e.raw.len(), "keywords": kw })
                })
                .collect();
            Ok(json!({ "accountId": "A1", "list": list, "notFound": [] }))
        }
        "Email/set" => {
            let mut out = json!({ "accountId": "A1" });
            if let Some(u) = a["update"].as_object() {
                for (id, patch) in u {
                    if let Some(e) = s.emails.iter_mut().find(|e| &e.id == id) {
                        patch_email(e, patch);
                    }
                }
            }
            if let Some(d) = a["destroy"].as_array() {
                let ids: Vec<&str> = d.iter().filter_map(|x| x.as_str()).collect();
                s.emails.retain(|e| !ids.contains(&e.id.as_str()));
            }
            Ok(out.take())
        }
        "Email/import" => {
            let mut ok = serde_json::Map::new();
            for (k, v) in a["emails"].as_object().cloned().unwrap_or_default() {
                let raw = s.blobs.get(v["blobId"].as_str().unwrap_or("")).cloned().ok_or("blob desconocido")?;
                let id = format!("em{}", s.next);
                s.next += 1;
                let mailboxes = v["mailboxIds"].as_object().map(|o| o.keys().cloned().collect()).unwrap_or_default();
                let keywords = v["keywords"].as_object().map(|o| o.keys().cloned().collect()).unwrap_or_default();
                let received = 1_000_000 + s.next as u64;
                s.emails.push(JEmail { id: id.clone(), mailboxes, keywords, raw, received });
                created.insert(k.clone(), id.clone());
                ok.insert(k, json!({ "id": id }));
            }
            Ok(json!({ "accountId": "A1", "created": ok }))
        }
        "Identity/get" => Ok(json!({ "accountId": "A1", "list": [{ "id": "I1", "email": "ana@ejemplo.es" }] })),
        "EmailSubmission/set" => {
            let mut ok = serde_json::Map::new();
            let mut bad = serde_json::Map::new();
            for (k, v) in a["create"].as_object().cloned().unwrap_or_default() {
                let eref = v["emailId"].as_str().unwrap_or("");
                let eid = eref.strip_prefix('#').and_then(|r| created.get(r).cloned()).unwrap_or(eref.to_string());
                let rcpts: Vec<String> = v["envelope"]["rcptTo"].as_array().map(|r| r.iter().filter_map(|x| x["email"].as_str().map(|s| s.to_string())).collect()).unwrap_or_default();
                if s.reject_domain.as_ref().map_or(false, |d| rcpts.iter().any(|r| r.ends_with(&format!("@{d}")))) {
                    bad.insert(k, json!({ "type": "invalidRecipients" }));
                    continue;
                }
                let Some(e) = s.emails.iter().find(|e| e.id == eid).cloned() else {
                    bad.insert(k, json!({ "type": "invalidProperties" }));
                    continue;
                };
                s.submitted.push((v["envelope"]["mailFrom"]["email"].as_str().unwrap_or("").to_string(), rcpts, e.raw.clone()));
                created.insert(k.clone(), format!("sub-{k}"));
                ok.insert(k.clone(), json!({ "id": format!("sub-{k}") }));
                // el servidor aplica los cambios al mensaje tras enviarlo
                if let Some(patch) = a["onSuccessUpdateEmail"][format!("#{k}")].as_object() {
                    if let Some(em) = s.emails.iter_mut().find(|e| e.id == eid) {
                        patch_email(em, &Value::Object(patch.clone()));
                    }
                }
            }
            let mut out = json!({ "accountId": "A1", "created": ok });
            if !bad.is_empty() {
                out["notCreated"] = Value::Object(bad);
            }
            Ok(out)
        }
        _ => Err(format!("método desconocido {name}")),
    }
}

// ------------------------------------------------------------------ Exchange (EWS)

#[derive(Clone)]
pub struct EItem {
    pub id: String,
    pub folder: String,
    pub raw: Vec<u8>,
    pub read: bool,
    pub flagged: bool,
    pub received: u64,
}

pub struct EState {
    pub user: String,
    pub pass: String,
    pub token: Option<String>,
    /// (id, padre, nombre, rol distinguido)
    pub folders: Vec<(String, String, String, Option<String>)>,
    pub items: Vec<EItem>,
    pub sent: Vec<Vec<u8>>,
    next: u32,
}

pub struct FakeEws {
    pub port: u16,
    pub state: Arc<Mutex<EState>>,
}

pub fn eitem(id: &str, folder: &str, read: bool, subject: &str, received: u64) -> EItem {
    let raw = format!("From: Ana <ana@ejemplo.es>\r\nTo: luis@ejemplo.es\r\nSubject: {subject}\r\nMessage-ID: <{id}@ews>\r\nDate: Mon, 3 Mar 2025 10:00:00 +0000\r\n\r\ncuerpo de {id}\r\n");
    EItem { id: id.into(), folder: folder.into(), raw: raw.into_bytes(), read, flagged: false, received }
}

impl FakeEws {
    pub fn start(user: &str, pass: &str) -> FakeEws {
        // identificadores con «=», «+» y «/» como los de Exchange
        let folders = vec![
            ("AAMkROOT=".to_string(), "".to_string(), "Raíz".to_string(), Some("msgfolderroot".to_string())),
            ("AAMkINBOX+1=".into(), "AAMkROOT=".into(), "Bandeja de entrada".into(), Some("inbox".into())),
            ("AAMkSENT/2=".into(), "AAMkROOT=".into(), "Elementos enviados".into(), Some("sentitems".into())),
            ("AAMkDRAFT=".into(), "AAMkROOT=".into(), "Borradores".into(), Some("drafts".into())),
            ("AAMkTRASH=".into(), "AAMkROOT=".into(), "Elementos eliminados".into(), Some("deleteditems".into())),
            ("AAMkWORK=".into(), "AAMkROOT=".into(), "Trabajo".into(), None),
            ("AAMkPROJ=".into(), "AAMkWORK=".into(), "Proyecto A".into(), None),
        ];
        let state = Arc::new(Mutex::new(EState { user: user.into(), pass: pass.into(), token: None, folders, items: vec![], sent: vec![], next: 1 }));
        let st = state.clone();
        let port = serve(Arc::new(move |req, _| ews_handle(&st, req)));
        FakeEws { port, state }
    }
    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}/EWS/Exchange.asmx", self.port)
    }
    pub fn item(&self, id: &str) -> Option<EItem> {
        self.state.lock().unwrap().items.iter().find(|i| i.id == id).cloned()
    }
}

fn envelope(body: &str) -> Resp {
    Resp {
        status: 200,
        content_type: "text/xml",
        body: format!("<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\"><s:Body>{body}</s:Body></s:Envelope>").into_bytes(),
    }
}

fn ok_msg(inner: &str) -> String {
    format!("<m:ResponseCode>NoError</m:ResponseCode>{inner}")
}

fn err_msg(code: &str, text: &str) -> String {
    format!("<m:ResponseMessage ResponseClass=\"Error\"><m:MessageText>{text}</m:MessageText><m:ResponseCode>{code}</m:ResponseCode></m:ResponseMessage>")
}

fn find<'a>(n: &'a Node, name: &str) -> Vec<&'a Node> {
    n.find_all(name)
}

fn ews_handle(st: &Arc<Mutex<EState>>, req: &Req) -> Resp {
    let mut s = st.lock().unwrap();
    if !authorized(req, &s.user.clone(), &s.pass.clone(), &s.token.clone()) {
        return Resp::status(401);
    }
    let xml = String::from_utf8_lossy(&req.body).to_string();
    let doc = match parse_xml(&xml) {
        Ok(d) => d,
        Err(_) => return Resp::status(400),
    };
    let body = find(&doc, "Body");
    let op = body.first().and_then(|b| b.children.first()).cloned().unwrap_or_default();
    let ids_of = |n: &Node, wrap: &str| -> Vec<String> { find(n, wrap).first().map(|w| w.children.iter().filter_map(|c| c.attr("Id").map(|s| s.to_string())).collect()).unwrap_or_default() };
    let msg = |class: &str, inner: String| format!("<m:ResponseMessage ResponseClass=\"{class}\">{inner}</m:ResponseMessage>");
    let wrap = |name: &str, items: Vec<String>| envelope(&format!("<m:{name}Response><m:ResponseMessages>{}</m:ResponseMessages></m:{name}Response>", items.join("")));
    let folder_by_distinguished = |s: &EState, d: &str| s.folders.iter().find(|f| f.3.as_deref() == Some(d)).map(|f| f.0.clone());
    match op.name.as_str() {
        "GetFolder" => {
            let mut out = vec![];
            for d in find(&op, "DistinguishedFolderId") {
                let want = d.attr("Id").unwrap_or("");
                out.push(match folder_by_distinguished(&s, want) {
                    Some(id) => msg("Success", ok_msg(&format!("<m:Folders><t:Folder><t:FolderId Id=\"{}\" ChangeKey=\"ck\"/></t:Folder></m:Folders>", esc(&id)))),
                    None => err_msg("ErrorFolderNotFound", "no existe"),
                });
            }
            wrap("GetFolder", out)
        }
        "FindFolder" => {
            let list: String = s
                .folders
                .iter()
                .filter(|f| f.3.as_deref() != Some("msgfolderroot"))
                .map(|f| format!("<t:Folder><t:FolderId Id=\"{}\"/><t:ParentFolderId Id=\"{}\"/><t:FolderClass>IPF.Note</t:FolderClass><t:DisplayName>{}</t:DisplayName></t:Folder>", esc(&f.0), esc(&f.1), esc(&f.2)))
                .collect();
            wrap("FindFolder", vec![msg("Success", ok_msg(&format!("<m:RootFolder TotalItemsInView=\"0\" IncludesLastItemInRange=\"true\"><t:Folders>{list}</t:Folders></m:RootFolder>")))])
        }
        "FindItem" => {
            let folder = ids_of(&op, "ParentFolderIds").first().cloned().unwrap_or_default();
            let offset: usize = find(&op, "IndexedPageItemView").first().and_then(|n| n.attr("Offset")).and_then(|v| v.parse().ok()).unwrap_or(0);
            let max: usize = find(&op, "IndexedPageItemView").first().and_then(|n| n.attr("MaxEntriesReturned")).and_then(|v| v.parse().ok()).unwrap_or(100);
            let mut all: Vec<&EItem> = s.items.iter().filter(|i| i.folder == folder).collect();
            all.sort_by_key(|i| std::cmp::Reverse(i.received));
            let page: Vec<&&EItem> = all.iter().skip(offset).take(max).collect();
            let last = offset + page.len() >= all.len();
            let items: String = page
                .iter()
                .map(|i| format!("<t:Message><t:ItemId Id=\"{}\" ChangeKey=\"k\"/><t:Size>{}</t:Size><t:IsRead>{}</t:IsRead><t:Flag><t:FlagStatus>{}</t:FlagStatus></t:Flag></t:Message>", esc(&i.id), i.raw.len(), i.read, if i.flagged { "Flagged" } else { "NotFlagged" }))
                .collect();
            wrap("FindItem", vec![msg("Success", ok_msg(&format!("<m:RootFolder TotalItemsInView=\"{}\" IncludesLastItemInRange=\"{last}\"><t:Items>{items}</t:Items></m:RootFolder>", all.len())))])
        }
        "GetItem" => {
            let with_mime = xml.contains("IncludeMimeContent");
            let ids = ids_of(&op, "ItemIds");
            let mut out = vec![];
            for id in ids {
                out.push(match s.items.iter().find(|i| i.id == id) {
                    Some(i) => {
                        let mime = if with_mime { format!("<t:MimeContent CharacterSet=\"UTF-8\">{}</t:MimeContent>", base64::engine::general_purpose::STANDARD.encode(&i.raw)) } else { String::new() };
                        msg("Success", ok_msg(&format!("<m:Items><t:Message>{mime}<t:ItemId Id=\"{}\" ChangeKey=\"k\"/><t:Size>{}</t:Size><t:IsRead>{}</t:IsRead><t:Flag><t:FlagStatus>{}</t:FlagStatus></t:Flag></t:Message></m:Items>", esc(&i.id), i.raw.len(), i.read, if i.flagged { "Flagged" } else { "NotFlagged" })))
                    }
                    None => err_msg("ErrorItemNotFound", "no existe"),
                });
            }
            wrap("GetItem", out)
        }
        "UpdateItem" => {
            let mut out = vec![];
            for ch in find(&op, "ItemChange") {
                let id = ch.child("ItemId").and_then(|x| x.attr("Id")).unwrap_or("").to_string();
                let read = find(ch, "IsRead").first().map(|n| n.text == "true");
                let flag = find(ch, "FlagStatus").first().map(|n| n.text == "Flagged");
                match s.items.iter_mut().find(|i| i.id == id) {
                    Some(i) => {
                        if let Some(r) = read {
                            i.read = r;
                        }
                        if let Some(f) = flag {
                            i.flagged = f;
                        }
                        out.push(msg("Success", ok_msg("")));
                    }
                    None => out.push(err_msg("ErrorItemNotFound", "no existe")),
                }
            }
            wrap("UpdateItem", out)
        }
        "MoveItem" => {
            let to = ids_of(&op, "ToFolderId").first().cloned().unwrap_or_default();
            if !s.folders.iter().any(|f| f.0 == to) {
                return wrap("MoveItem", vec![err_msg("ErrorFolderNotFound", "no existe")]);
            }
            let mut out = vec![];
            for id in ids_of(&op, "ItemIds") {
                match s.items.iter_mut().find(|i| i.id == id) {
                    Some(i) => {
                        i.folder = to.clone();
                        // al moverse, el elemento recibe otro identificador (como en Exchange)
                        i.id = format!("{}M", i.id.trim_end_matches('='));
                        out.push(msg("Success", ok_msg("")));
                    }
                    None => out.push(err_msg("ErrorItemNotFound", "no existe")),
                }
            }
            wrap("MoveItem", out)
        }
        "DeleteItem" => {
            let mut out = vec![];
            for id in ids_of(&op, "ItemIds") {
                let before = s.items.len();
                s.items.retain(|i| i.id != id);
                out.push(if s.items.len() < before { msg("Success", ok_msg("")) } else { err_msg("ErrorItemNotFound", "no existe") });
            }
            wrap("DeleteItem", out)
        }
        "CreateItem" => {
            let sendsave = op.attr("MessageDisposition") == Some("SendAndSaveCopy");
            let folder = if sendsave { folder_by_distinguished(&s, "sentitems").unwrap_or_default() } else { ids_of(&op, "SavedItemFolderId").first().cloned().unwrap_or_default() };
            let mime = find(&op, "MimeContent").first().map(|n| n.text.clone()).unwrap_or_default();
            let raw = base64::engine::general_purpose::STANDARD.decode(mime.trim()).unwrap_or_default();
            // PR_MESSAGE_FLAGS: 1 = leído
            let read = find(&op, "Value").first().map_or(sendsave, |v| v.text == "1");
            let id = format!("AAMkNEW{}=", s.next);
            s.next += 1;
            if sendsave {
                s.sent.push(raw.clone());
            }
            let received = 2_000_000 + s.next as u64;
            s.items.push(EItem { id, folder, raw, read, flagged: false, received });
            wrap("CreateItem", vec![msg("Success", ok_msg(""))])
        }
        "CreateFolder" => {
            let parent = ids_of(&op, "ParentFolderId").first().cloned().or_else(|| find(&op, "DistinguishedFolderId").first().and_then(|d| folder_by_distinguished(&s, d.attr("Id").unwrap_or("")))).unwrap_or_default();
            let name = find(&op, "DisplayName").first().map(|n| n.text.clone()).unwrap_or_default();
            let id = format!("AAMkF{}=", s.next);
            s.next += 1;
            s.folders.push((id, parent, name, None));
            wrap("CreateFolder", vec![msg("Success", ok_msg(""))])
        }
        "DeleteFolder" => {
            let id = ids_of(&op, "FolderIds").first().cloned().unwrap_or_default();
            s.folders.retain(|f| f.0 != id);
            wrap("DeleteFolder", vec![msg("Success", ok_msg(""))])
        }
        other => envelope(&format!("<s:Fault><faultcode>s:Client</faultcode><faultstring>operación desconocida {other}</faultstring></s:Fault>")),
    }
}

// ------------------------------------------------------------------ punto de tokens de OAuth

pub struct OAuthState {
    pub client_id: String,
    pub code: String,
    /// El `code_challenge` que se vio en la dirección de autorización (lo anota la prueba).
    pub challenge: Mutex<Option<String>>,
    pub refresh: String,
    pub requests: Mutex<Vec<String>>,
    pub access_counter: Mutex<u32>,
}

pub struct FakeOAuth {
    pub port: u16,
    pub state: Arc<OAuthState>,
}

impl FakeOAuth {
    pub fn start(client_id: &str, code: &str, refresh: &str) -> FakeOAuth {
        let state = Arc::new(OAuthState { client_id: client_id.into(), code: code.into(), challenge: Mutex::new(None), refresh: refresh.into(), requests: Mutex::new(vec![]), access_counter: Mutex::new(0) });
        let st = state.clone();
        let port = serve(Arc::new(move |req, _| {
            if req.method != "POST" || req.path != "/token" {
                return Resp::status(404);
            }
            let text = String::from_utf8_lossy(&req.body).to_string();
            st.requests.lock().unwrap().push(text.clone());
            let form: HashMap<String, String> = text.split('&').filter_map(|kv| kv.split_once('=')).map(|(k, v)| (super::auth::pct_decode(k), super::auth::pct_decode(v))).collect();
            let get = |k: &str| form.get(k).cloned().unwrap_or_default();
            let bad = |e: &str| Resp { status: 400, content_type: "application/json", body: json!({ "error": e, "error_description": "no" }).to_string().into_bytes() };
            if get("client_id") != st.client_id {
                return bad("invalid_client");
            }
            let mut n = st.access_counter.lock().unwrap();
            *n += 1;
            match get("grant_type").as_str() {
                "authorization_code" => {
                    use sha2::{Digest, Sha256};
                    let want = st.challenge.lock().unwrap().clone().unwrap_or_default();
                    let got = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(get("code_verifier").as_bytes()));
                    if get("code") != st.code || got != want {
                        return bad("invalid_grant");
                    }
                    Resp::json(json!({ "access_token": format!("AT{}", *n), "refresh_token": st.refresh, "expires_in": 3600, "token_type": "Bearer" }))
                }
                "refresh_token" => {
                    if get("refresh_token") != st.refresh {
                        return bad("invalid_grant");
                    }
                    Resp::json(json!({ "access_token": format!("AT{}", *n), "expires_in": 3600, "token_type": "Bearer" }))
                }
                _ => bad("unsupported_grant_type"),
            }
        }));
        FakeOAuth { port, state }
    }
    pub fn token_url(&self) -> String {
        format!("http://127.0.0.1:{}/token", self.port)
    }
}
