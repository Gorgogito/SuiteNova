//! JMAP (RFC 8620 y 8621): correo por HTTP y JSON (Fastmail, Stalwart y otros). Las carpetas se llaman buzones y los
//! mensajes tienen identificador propio. El servidor guarda por sí mismo la copia en Enviados al enviar.

use super::account::{Account, AuthKind};
use super::backend::{check_flag, Backend, Creds, Fetched, FolderState, RemoteFolder, RemoteMessage, Skipped, StateItem};
use super::http::{agent, checked, explain, read_limited};
use base64::Engine;
use serde_json::{json, Value};
use std::collections::HashMap;

const CORE: &str = "urn:ietf:params:jmap:core";
const MAIL: &str = "urn:ietf:params:jmap:mail";
const SUBMISSION: &str = "urn:ietf:params:jmap:submission";
const CHUNK: usize = 100;

pub struct Jmap {
    agent: ureq::Agent,
    auth: String,
    api_url: String,
    download_url: String,
    upload_url: String,
    account_id: String,
    has_submission: bool,
}

fn pct(s: &str) -> String {
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

fn ids_ok(keys: &[String]) -> Result<(), String> {
    if keys.is_empty() || keys.len() > 5000 {
        return Err("Hay que indicar entre 1 y 5000 mensajes.".into());
    }
    if keys.iter().any(|k| k.is_empty() || k.len() > 255 || !k.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')) {
        return Err("El identificador del mensaje no es válido.".into());
    }
    Ok(())
}

impl Jmap {
    pub fn connect(account: &Account, creds: &Creds) -> Result<Jmap, String> {
        let url = account.url.clone().ok_or("JMAP: falta la dirección del servicio.")?;
        let auth = match creds {
            Creds::Token(t) => format!("Bearer {t}"),
            Creds::Password(p) => {
                if account.auth.kind == AuthKind::Oauth {
                    return Err("JMAP con OAuth necesita un token.".into());
                }
                format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(format!("{}:{p}", account.username)))
            }
        };
        let agent = agent()?;
        let session: Value = agent.get(&checked("JMAP", &url)?).set("Authorization", &auth).set("Accept", "application/json").call().map_err(explain)?.into_json().map_err(|_| "La respuesta de JMAP no es válida.".to_string())?;
        let s = |k: &str| -> Result<String, String> { session[k].as_str().map(|x| x.to_string()).ok_or_else(|| format!("La sesión JMAP no incluye «{k}».")) };
        let api_url = checked("JMAP", &s("apiUrl")?)?;
        let download_url = checked("JMAP", &s("downloadUrl")?)?;
        let upload_url = checked("JMAP", &s("uploadUrl")?)?;
        let caps = session["capabilities"].as_object().ok_or("La sesión JMAP no tiene capacidades.")?;
        if !caps.contains_key(MAIL) {
            return Err("Este servidor JMAP no ofrece correo.".into());
        }
        let account_id = session["primaryAccounts"][MAIL].as_str().map(|x| x.to_string()).or_else(|| session["accounts"].as_object().and_then(|m| m.keys().next().cloned())).ok_or("La sesión JMAP no tiene ninguna cuenta de correo.")?;
        Ok(Jmap { agent, auth, api_url, download_url, upload_url, account_id, has_submission: caps.contains_key(SUBMISSION) })
    }

    /// Una petición con varias llamadas; devuelve las respuestas por su identificador de llamada.
    fn call(&self, calls: Vec<(&str, Value, &str)>) -> Result<HashMap<String, Value>, String> {
        let mut using = vec![CORE, MAIL];
        if self.has_submission {
            using.push(SUBMISSION);
        }
        let body = json!({ "using": using, "methodCalls": calls.iter().map(|(n, a, id)| json!([n, a, id])).collect::<Vec<_>>() });
        let resp: Value = self.agent.post(&self.api_url).set("Authorization", &self.auth).send_json(body).map_err(explain)?.into_json().map_err(|_| "La respuesta de JMAP no es válida.".to_string())?;
        let mut out = HashMap::new();
        for r in resp["methodResponses"].as_array().ok_or("La respuesta de JMAP no tiene resultados.")? {
            let (name, args, id) = (r[0].as_str().unwrap_or(""), &r[1], r[2].as_str().unwrap_or(""));
            if name == "error" {
                let t = args["type"].as_str().unwrap_or("error");
                let d = args["description"].as_str().unwrap_or("");
                return Err(format!("El servidor JMAP devolvió un error ({t}){}", if d.is_empty() { String::new() } else { format!(": {}", super::tls::clean(d)) }));
            }
            out.insert(id.to_string(), args.clone());
        }
        Ok(out)
    }

    fn mailboxes(&self) -> Result<Vec<Value>, String> {
        let r = self.call(vec![("Mailbox/get", json!({ "accountId": self.account_id, "ids": null }), "m")])?;
        Ok(r["m"]["list"].as_array().cloned().unwrap_or_default())
    }

    fn role_id(&self, role: &str) -> Result<Option<String>, String> {
        Ok(self.mailboxes()?.iter().find(|m| m["role"].as_str() == Some(role)).and_then(|m| m["id"].as_str().map(|s| s.to_string())))
    }

    fn upload(&self, raw: &[u8]) -> Result<String, String> {
        let url = self.upload_url.replace("{accountId}", &pct(&self.account_id));
        let r: Value = self.agent.post(&url).set("Authorization", &self.auth).set("Content-Type", "message/rfc822").send_bytes(raw).map_err(explain)?.into_json().map_err(|_| "La respuesta de la subida no es válida.".to_string())?;
        r["blobId"].as_str().map(|s| s.to_string()).ok_or_else(|| "El servidor no devolvió el identificador de lo subido.".to_string())
    }

    fn folder_list(&self) -> Result<Vec<RemoteFolder>, String> {
        let list = self.mailboxes()?;
        let by_id: HashMap<&str, &Value> = list.iter().filter_map(|m| Some((m["id"].as_str()?, m))).collect();
        let mut out = vec![];
        for m in &list {
            let Some(id) = m["id"].as_str() else { continue };
            // ruta completa subiendo por los padres (con un tope por si el servidor devuelve un ciclo)
            let mut parts = vec![m["name"].as_str().unwrap_or("").to_string()];
            let mut cur = m["parentId"].as_str();
            for _ in 0..30 {
                let Some(p) = cur.and_then(|p| by_id.get(p)) else { break };
                parts.push(p["name"].as_str().unwrap_or("").to_string());
                cur = p["parentId"].as_str();
            }
            parts.reverse();
            let mut attrs = vec![];
            match m["role"].as_str() {
                Some("inbox") => attrs.push("\\Inbox"),
                Some("sent") => attrs.push("\\Sent"),
                Some("drafts") => attrs.push("\\Drafts"),
                Some("trash") => attrs.push("\\Trash"),
                Some("junk") => attrs.push("\\Junk"),
                Some("archive") => attrs.push("\\Archive"),
                Some("all") => attrs.push("\\All"),
                Some("flagged") => attrs.push("\\Flagged"),
                Some("important") => attrs.push("\\Important"),
                _ => {}
            }
            out.push(RemoteFolder { name: id.to_string(), path: parts.join("/"), delimiter: Some("/".into()), attrs: attrs.into_iter().map(String::from).collect() });
        }
        Ok(out)
    }

    fn keywords(flags: &[(&str, bool)]) -> Value {
        let mut m = serde_json::Map::new();
        for (k, on) in flags {
            if *on {
                m.insert(k.to_string(), json!(true));
            }
        }
        Value::Object(m)
    }

    fn check_set(&self, r: &Value, key: &str) -> Result<(), String> {
        if let Some(o) = r[key].as_object() {
            if let Some((_, e)) = o.iter().next() {
                let t = e["type"].as_str().unwrap_or("error");
                return Err(format!("El servidor JMAP rechazó el cambio ({t}){}", e["description"].as_str().map(|d| format!(": {}", super::tls::clean(d))).unwrap_or_default()));
            }
        }
        Ok(())
    }
}

fn flags_of(keywords: &Value) -> Vec<String> {
    let mut v = vec![];
    for (k, f) in [("$seen", "\\Seen"), ("$flagged", "\\Flagged"), ("$answered", "\\Answered")] {
        if keywords[k].as_bool() == Some(true) {
            v.push(f.to_string());
        }
    }
    v
}

fn keyword_of(flag: &str) -> &'static str {
    match flag {
        "\\Seen" => "$seen",
        "\\Flagged" => "$flagged",
        _ => "$answered",
    }
}

impl Backend for Jmap {
    fn list_folders(&mut self) -> Result<Vec<RemoteFolder>, String> {
        self.folder_list()
    }

    fn folder_state(&mut self, folder: &str) -> Result<FolderState, String> {
        ids_ok(&[folder.to_string()])?;
        let q = self.call(vec![("Email/query", json!({ "accountId": self.account_id, "filter": { "inMailbox": folder }, "sort": [{ "property": "receivedAt", "isAscending": false }], "limit": 50000 }), "q")])?;
        let ids: Vec<String> = q["q"]["ids"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect()).unwrap_or_default();
        let mut items = vec![];
        for chunk in ids.chunks(250) {
            let r = self.call(vec![("Email/get", json!({ "accountId": self.account_id, "ids": chunk, "properties": ["id", "keywords", "size"] }), "g")])?;
            let mut got: HashMap<String, StateItem> = HashMap::new();
            for e in r["g"]["list"].as_array().cloned().unwrap_or_default() {
                let Some(id) = e["id"].as_str() else { continue };
                got.insert(id.to_string(), StateItem { key: id.to_string(), flags: flags_of(&e["keywords"]), size: e["size"].as_u64().unwrap_or(0).min(u32::MAX as u64) as u32 });
            }
            for id in chunk {
                if let Some(i) = got.remove(id) {
                    items.push(i);
                }
            }
        }
        Ok(FolderState { validity: "jmap".into(), items, mirror_deletions: true })
    }

    fn fetch(&mut self, _folder: &str, keys: &[String], max_bytes: u32) -> Result<Fetched, String> {
        ids_ok(keys)?;
        let mut out = Fetched::default();
        for chunk in keys.chunks(CHUNK) {
            let r = self.call(vec![("Email/get", json!({ "accountId": self.account_id, "ids": chunk, "properties": ["id", "blobId", "size", "keywords"] }), "g")])?;
            for e in r["g"]["list"].as_array().cloned().unwrap_or_default() {
                let (Some(id), Some(blob)) = (e["id"].as_str(), e["blobId"].as_str()) else { continue };
                let size = e["size"].as_u64().unwrap_or(0).min(u32::MAX as u64) as u32;
                if size > max_bytes {
                    out.skipped.push(Skipped { key: id.to_string(), size });
                    continue;
                }
                let url = self.download_url.replace("{accountId}", &pct(&self.account_id)).replace("{blobId}", &pct(blob)).replace("{name}", "mensaje.eml").replace("{type}", &pct("message/rfc822"));
                let resp = self.agent.get(&checked("JMAP", &url)?).set("Authorization", &self.auth).call().map_err(explain)?;
                let bytes = read_limited(resp, max_bytes as u64 + 4096)?;
                out.messages.push(RemoteMessage { key: id.to_string(), flags: flags_of(&e["keywords"]), raw: base64::engine::general_purpose::STANDARD.encode(bytes) });
            }
        }
        Ok(out)
    }

    fn set_flag(&mut self, _folder: &str, keys: &[String], flag: &str, on: bool) -> Result<(), String> {
        let kw = keyword_of(check_flag(flag)?);
        ids_ok(keys)?;
        for chunk in keys.chunks(CHUNK) {
            let mut update = serde_json::Map::new();
            for id in chunk {
                update.insert(id.clone(), json!({ format!("keywords/{kw}"): if on { json!(true) } else { Value::Null } }));
            }
            let r = self.call(vec![("Email/set", json!({ "accountId": self.account_id, "update": update }), "s")])?;
            self.check_set(&r["s"], "notUpdated")?;
        }
        Ok(())
    }

    fn move_to(&mut self, folder: &str, keys: &[String], to: &str) -> Result<(), String> {
        ids_ok(keys)?;
        ids_ok(&[to.to_string()])?;
        for chunk in keys.chunks(CHUNK) {
            let mut update = serde_json::Map::new();
            for id in chunk {
                update.insert(id.clone(), json!({ format!("mailboxIds/{folder}"): Value::Null, format!("mailboxIds/{to}"): true }));
            }
            let r = self.call(vec![("Email/set", json!({ "accountId": self.account_id, "update": update }), "s")])?;
            self.check_set(&r["s"], "notUpdated")?;
        }
        Ok(())
    }

    fn remove(&mut self, _folder: &str, keys: &[String]) -> Result<(), String> {
        ids_ok(keys)?;
        for chunk in keys.chunks(CHUNK) {
            let r = self.call(vec![("Email/set", json!({ "accountId": self.account_id, "destroy": chunk }), "s")])?;
            self.check_set(&r["s"], "notDestroyed")?;
        }
        Ok(())
    }

    fn append(&mut self, folder: &str, raw: &[u8], seen: bool) -> Result<(), String> {
        ids_ok(&[folder.to_string()])?;
        let blob = self.upload(raw)?;
        let r = self.call(vec![("Email/import", json!({ "accountId": self.account_id, "emails": { "e1": { "blobId": blob, "mailboxIds": { folder: true }, "keywords": Jmap::keywords(&[("$seen", seen)]) } } }), "i")])?;
        self.check_set(&r["i"], "notCreated")
    }

    fn create_folder(&mut self, path: &str) -> Result<(), String> {
        let mut segs: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
        let Some(name) = segs.pop() else { return Err("Falta el nombre de la carpeta.".into()) };
        let parent = if segs.is_empty() {
            Value::Null
        } else {
            let want = segs.join("/");
            let found = self.folder_list()?.into_iter().find(|f| f.path == want).ok_or("La carpeta superior no existe en el servidor.")?;
            json!(found.name)
        };
        let r = self.call(vec![("Mailbox/set", json!({ "accountId": self.account_id, "create": { "c1": { "name": name, "parentId": parent } } }), "c")])?;
        self.check_set(&r["c"], "notCreated")
    }

    fn delete_folder(&mut self, folder: &str) -> Result<(), String> {
        ids_ok(&[folder.to_string()])?;
        let r = self.call(vec![("Mailbox/set", json!({ "accountId": self.account_id, "destroy": [folder] }), "d")])?;
        self.check_set(&r["d"], "notDestroyed")
    }

    fn send(&mut self, from: &str, recipients: &[String], raw: &[u8]) -> Result<(), String> {
        if !self.has_submission {
            return Err("Este servidor JMAP no permite enviar correo.".into());
        }
        let drafts = self.role_id("drafts")?;
        let sent = self.role_id("sent")?;
        let ident = self.call(vec![("Identity/get", json!({ "accountId": self.account_id, "ids": null }), "i")])?;
        let list = ident["i"]["list"].as_array().cloned().unwrap_or_default();
        let identity = list.iter().find(|i| i["email"].as_str().map_or(false, |e| e.eq_ignore_ascii_case(from))).or(list.first()).and_then(|i| i["id"].as_str()).ok_or("El servidor no tiene ninguna identidad para enviar.")?.to_string();
        let blob = self.upload(raw)?;
        let mailbox = drafts.clone().or(sent.clone()).ok_or("El servidor no tiene carpeta de borradores ni de enviados.")?;
        // se importa el mensaje y se envía; al terminar el servidor lo pasa a Enviados (su propia copia)
        let mut on_success = serde_json::Map::new();
        on_success.insert("keywords/$draft".into(), Value::Null);
        if let Some(s) = &sent {
            if *s != mailbox {
                on_success.insert(format!("mailboxIds/{mailbox}"), Value::Null);
                on_success.insert(format!("mailboxIds/{s}"), json!(true));
            }
        }
        let r = self.call(vec![
            ("Email/import", json!({ "accountId": self.account_id, "emails": { "e1": { "blobId": blob, "mailboxIds": { mailbox: true }, "keywords": { "$draft": true, "$seen": true } } } }), "i"),
            (
                "EmailSubmission/set",
                json!({
                    "accountId": self.account_id,
                    "create": { "s1": { "identityId": identity, "emailId": "#e1", "envelope": { "mailFrom": { "email": from }, "rcptTo": recipients.iter().map(|r| json!({ "email": r })).collect::<Vec<_>>() } } },
                    "onSuccessUpdateEmail": { "#s1": Value::Object(on_success) }
                }),
                "s",
            ),
        ])?;
        self.check_set(&r["i"], "notCreated")?;
        self.check_set(&r["s"], "notCreated")
    }

    fn logout(self: Box<Self>) {}
}
